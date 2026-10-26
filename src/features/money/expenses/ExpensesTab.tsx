import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChartColumn, ChevronLeft, ChevronRight, Ellipsis, History, Lock, Pencil, Receipt, Trash2 } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { matchesAllWords, useQueryParamText } from '@/lib/useQueryParamText'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { FilterSheet } from '@/ui/FilterSheet'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { Money } from '@/ui/Money'
import { NoResults } from '@/ui/NoResults'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { TableFilter } from '@/ui/TableFilter'
import { Tag } from '@/ui/Tag'
import { Select } from '@/ui/form/Select'
import { LazyHistoryPanel } from '@/features/history/LazyHistoryPanel'
import { useClosedMonths } from '@/features/money/monthEnd/hooks'
import type { ExpenseListing } from '@/features/money/expenses/api'
import { AddExpenseDialog } from '@/features/money/expenses/ExpenseDialog'
import { CLOSED_MONTH_LINE, useDeleteExpenseFlow } from '@/features/money/expenses/deleteFlow'
import { useCategories, useExpenseMonth, useGroups } from '@/features/money/expenses/hooks'
import { RecurringPanel } from '@/features/money/expenses/RecurringPanel'
import { forMonthNote } from '@/features/money/expenses/forMonth'
import {
  NO_FILTERS,
  PAID_VIA_LABEL,
  bySection,
  filterExpenses,
  listTotals,
  monthKey,
  monthKeyLabel,
  monthKeyShort,
  pkr,
  sectionOf,
  sectionTotals,
  shiftMonth,
  sortGroups,
  type Category,
  type ExpenseFilters,
  type ExpenseGroup,
  type ListedExpense,
  type PaidVia,
} from '@/features/money/expenses/model'

/*
 * Money › Expenses (M03, M11; grouped 0086; admin only). One month at a time, by payment date. The month's ONE total sits in the
 * toolbar beside the month ("PKR 2,330,850 · 48 expenses"), so it is read before any row. The rows are grouped by their
 * category's group (Office running, Vehicles, Staff, Order costs, Owner and loans) with a subtotal each, so supplier payments
 * never hide among the snacks. "Search expenses" (payee, detail, category, order number; `?q=`) and Filters (group, category,
 * paid via). Input tax shows as a column only in a month that has some. A row opens for editing; its "⋯" holds Edit and Delete.
 * Delete (here and in the edit dialog, one flow: deleteFlow.tsx) asks once, then deletes at once and for good. A closed
 * month's rows carry a lock and cannot be edited or deleted (the database refuses too); one line says so and links Lock a month.
 */
interface ExpensesTabProps {
  /** Month to open on ("2026-11"); today's by default. */
  initialMonth?: string
}

const NO_GROUPS: readonly ExpenseGroup[] = []

export function ExpensesTab({ initialMonth }: ExpensesTabProps) {
  const today = businessToday()
  const [month, setMonth] = useState(initialMonth ?? monthKey(today))
  const [filters, setFilters] = useState<ExpenseFilters>(NO_FILTERS)
  const [q, setQ] = useQueryParamText()
  const [editing, setEditing] = useState<ListedExpense | null>(null)
  /** The expense whose History panel is open. */
  const [history, setHistory] = useState<ListedExpense | null>(null)

  const cats = useCategories()
  const groupsQ = useGroups()
  const list = useExpenseMonth(month)
  const closedQ = useClosedMonths()
  const categories = useMemo(() => cats.data ?? [], [cats.data])
  const groups = groupsQ.data ?? NO_GROUPS
  const monthClosed = (closedQ.data ?? []).some(c => c.key === month)
  const rows = useMemo(() => {
    const kept = filterExpenses(list.data?.rows ?? [], filters, categories)
    const found = q.trim() ? kept.filter(r => matchesAllWords(searchText(r, categories, list.data), q)) : kept
    return bySection(found, categories, groups)
  }, [list.data, filters, categories, groups, q])
  const totals = listTotals(rows)
  const sections = useMemo(() => sectionTotals(rows, categories, groups), [rows, categories, groups])
  const showTax = rows.some(r => r.inputTax > 0)
  const filtersOn = filterLabels(filters, categories, groups)
  const filtered = filtersOn.length > 0 || q.trim() !== ''
  const clearAll = () => {
    setFilters(NO_FILTERS)
    setQ('')
  }

  const deleteFlow = useDeleteExpenseFlow(r => categories.find(c => c.id === r.categoryId)?.name ?? 'Expense')
  const onDelete = deleteFlow.ask

  const columns = useMemo(
    () => buildColumns(categories, list.data, { showTax, locked: monthClosed, onEdit: setEditing, onDelete, onHistory: setHistory }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, list.data, showTax, monthClosed],
  )

  const isCurrent = month === monthKey(today)

  return (
    <div className="grid gap-4">
      <RecurringPanel categories={categories} today={today} />

      <section aria-labelledby="expenses-h" className="grid gap-3">
        {monthClosed ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border bg-sunken px-4 py-2 text-sm text-fg-2" data-testid="expenses-closed">
            <Icon icon={Lock} className="text-fg-muted" />
            <span>
              <b className="font-medium text-fg">{monthKeyLabel(month)} is closed.</b> {CLOSED_MONTH_LINE}
            </span>
            <Link to={`/money/month-end?month=${month}`} className="font-medium text-primary underline-offset-2 hover:underline">
              Open Lock a month
            </Link>
          </p>
        ) : null}
        <DataTable
          label="Expenses"
          columns={columns}
          rows={rows}
          getRowId={r => r.id}
          twoLine
          group={r => {
            const s = sectionOf(r, categories, groups)
            const t = sections.get(s.key)
            return {
              key: s.key,
              label: (
                <span className="flex w-full items-center justify-between gap-3">
                  <span>
                    {s.name}
                    <span className="num font-regular text-fg-muted"> · {t?.count ?? 0}</span>
                  </span>
                  <span className="num sm:hidden">{(t?.total ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </span>
              ),
            }
          }}
          groupStyle="big"
          onRowOpen={monthClosed ? undefined : r => setEditing(r)}
          footerLabel={`Total, ${monthKeyLabel(month)}`}
          loading={list.isPending}
          error={
            list.isError
              ? { title: "Couldn't load the expenses", message: 'Nothing was changed. Check your connection and try again.', onRetry: () => void list.refetch() }
              : null
          }
          toolbar={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 id="expenses-h" className="sr-only">
                Expenses
              </h2>
              <div className="inline-flex items-center gap-1" role="group" aria-label="Month">
                <Button variant="quiet" size="sm" icon={ChevronLeft} aria-label="Previous month" onClick={() => setMonth(m => shiftMonth(m, -1))} />
                <span className="num min-w-[84px] text-center text-base font-semibold" aria-live="polite" title={monthKeyLabel(month)}>
                  {monthKeyShort(month)}
                </span>
                <Button variant="quiet" size="sm" icon={ChevronRight} aria-label="Next month" disabled={isCurrent} onClick={() => setMonth(m => shiftMonth(m, 1))} />
              </div>
              {list.isSuccess ? (
                <span className="inline-flex items-center gap-1 text-base" data-testid="expenses-month-total" aria-live="polite">
                  <b className="num font-semibold">{pkr(totals.total)}</b>
                  <span className="num text-sm text-fg-muted">
                    {` · ${totals.count} ${totals.count === 1 ? 'expense' : 'expenses'}${filtered ? ' shown' : ''}`}
                  </span>
                  <InfoTip label="About this total">
                    What was paid in {monthKeyLabel(month)}, by the day paid, input tax included (what left the bank or the cash box). A monthly bill
                    paid this month for last month is in this total; the Expenses report counts it in the month it is for.
                    {totals.inputTax > 0 ? ` Input tax ${pkr(totals.inputTax)} of it is claimed back, so the cost is ${pkr(totals.cost)}.` : ''}
                  </InfoTip>
                </span>
              ) : null}
              <Link
                to={`/money/reports/expenses?by=month&period=${month}`}
                className="inline-flex min-h-[40px] items-center gap-1 rounded text-sm font-medium text-primary underline-offset-2 hover:underline max-sm:basis-full"
              >
                <Icon icon={ChartColumn} size="sm" />
                Report for {monthKeyShort(month)}
              </Link>
              <span className="flex-1" />
              <TableFilter label="Search expenses" hint="Finds an expense by payee, detail, category or order number." value={q} onChange={setQ} />
              <FilterSheet title="Filter expenses" on={filtersOn.length} shown={rows.length} noun={['expense', 'expenses']} onClear={() => setFilters(NO_FILTERS)}>
                <FilterSelects categories={categories} groups={groups} filters={filters} onChange={setFilters} />
              </FilterSheet>
            </div>
          }
          empty={
            filtered ? (
              <NoResults query={q} scope={`expenses in ${monthKeyLabel(month)}`} fields="payee, detail, category and order number" filtersOn={filtersOn} onClear={clearAll} />
            ) : (
              <EmptyState icon={Receipt} title={`No expenses in ${monthKeyLabel(month)}`}>
                Add every spend, even a Rs 500 water bottle, with Add expenses. It shows here under its group.
              </EmptyState>
            )
          }
          mobileRow={r => <ExpenseCard row={r} categories={categories} listing={list.data} locked={monthClosed} onEdit={setEditing} onDelete={onDelete} onHistory={setHistory} />}
        />
      </section>

      {editing ? (
        <AddExpenseDialog
          open
          expense={editing}
          onOpenChange={o => !o && setEditing(null)}
          onHistory={() => {
            setHistory(editing)
            setEditing(null)
          }}
        />
      ) : null}
      {history ? (
        <LazyHistoryPanel
          open
          onOpenChange={o => !o && setHistory(null)}
          table="expenses"
          id={history.id}
          context={`${categories.find(c => c.id === history.categoryId)?.name ?? 'Expense'} · ${formatShortDate(history.paidOn, undefined, true)}`}
        />
      ) : null}
      {deleteFlow.node}
    </div>
  )
}

function FilterSelects({
  categories,
  groups,
  filters,
  onChange,
}: {
  categories: readonly Category[]
  groups: readonly ExpenseGroup[]
  filters: ExpenseFilters
  onChange: (f: ExpenseFilters) => void
}) {
  const inGroup = filters.group === 'all' ? categories : categories.filter(c => c.groupId === filters.group)
  return (
    <>
      <div>
        <Select
          aria-label="Group"
          value={filters.group}
          onChange={e => onChange({ ...filters, group: e.target.value, categoryId: 'all' })}
          options={[{ value: 'all', label: 'All groups' }, ...sortGroups(groups).map(g => ({ value: g.id, label: g.name }))]}
        />
      </div>
      <div>
        <Select
          aria-label="Category"
          value={filters.categoryId}
          onChange={e => onChange({ ...filters, categoryId: e.target.value })}
          options={[{ value: 'all', label: 'All categories' }, ...inGroup.map(c => ({ value: c.id, label: c.active ? c.name : `${c.name} (archived)` }))]}
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

/** "Group: Vehicles", "Paid via: Bank": the filters that are on, for the Filters sheet and NoResults. */
function filterLabels(f: ExpenseFilters, categories: readonly Category[], groups: readonly ExpenseGroup[]): string[] {
  const on: string[] = []
  if (f.group !== 'all') on.push(`Group: ${groups.find(g => g.id === f.group)?.name ?? 'removed'}`)
  if (f.categoryId !== 'all') on.push(`Category: ${categories.find(c => c.id === f.categoryId)?.name ?? 'removed'}`)
  if (f.paidVia !== 'all') on.push(`Paid via: ${PAID_VIA_LABEL[f.paidVia]}`)
  return on
}

/** What "Search expenses" reads: category, payee, order number and the detail. */
function searchText(r: ListedExpense, categories: readonly Category[], l: ExpenseListing | undefined): string {
  const d = describe(r, categories, l)
  return `${d.name} ${d.detail}`
}

/** "Supplier payment" over "Alpenmark Controls GmbH · ORD-0038 · detail". A detail the same as the category is not repeated. */
function describe(r: ListedExpense, categories: readonly Category[], l: ExpenseListing | undefined) {
  const cat = categories.find(c => c.id === r.categoryId)
  const name = cat?.name ?? 'Category removed'
  const note = r.note && r.note.trim().toLowerCase() !== name.toLowerCase() ? r.note : null
  // 0087: "for September" when a monthly bill is for another month than the one it was paid in
  const parts = [forMonthNote(r.paidOn, r.period), r.payeeId ? l?.payees[r.payeeId] : null, r.orderId ? l?.orders[r.orderId] : null, note].filter(Boolean) as string[]
  return { name, detail: parts.join(' · '), inactive: cat ? !cat.active : false }
}

function buildColumns(
  categories: readonly Category[],
  listing: ExpenseListing | undefined,
  act: { showTax: boolean; locked: boolean; onEdit: (r: ListedExpense) => void; onDelete: (r: ListedExpense) => void; onHistory: (r: ListedExpense) => void },
): Column<ListedExpense>[] {
  const today = businessToday()
  const cols: Column<ListedExpense>[] = [
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
            {d.detail ? <span className="min-w-0 text-sm text-fg-2 [overflow-wrap:anywhere]">{d.detail}</span> : null}
          </div>
        )
      },
    },
    { id: 'via', header: 'Paid via', width: 96, value: r => r.paidVia, sortable: true, cell: r => <Tag>{PAID_VIA_LABEL[r.paidVia]}</Tag>, hideBelowMd: true },
  ]
  if (act.showTax)
    cols.push({
      id: 'tax',
      header: 'Input tax (PKR)',
      kind: 'money',
      width: 132,
      hideBelowMd: true,
      value: r => (r.inputTax > 0 ? r.inputTax : null),
      // a group (or month) with no input tax shows a blank, not a 0
      total: list => {
        const t = Math.round(list.reduce((s, r) => s + r.inputTax, 0) * 100) / 100
        return t > 0 ? <Money value={t} prefix={false} strong /> : null
      },
    })
  cols.push(
    { id: 'amount', header: 'Amount (PKR)', kind: 'money', width: 140, sortable: true, value: r => r.amount, total: true },
    {
      id: 'actions',
      header: 'Actions',
      width: 84,
      cell: r => {
        const name = describe(r, categories, listing).name
        // A closed month cannot be edited or deleted, but what changed and who changed it is still there to read: History sits by the lock.
        if (act.locked)
          return (
            <span className="inline-flex items-center gap-1">
              <span className="inline-grid size-[36px] place-items-center text-fg-muted" title="Locked: the month is closed">
                <Icon icon={Lock} size="sm" />
                <span className="sr-only">Locked, the month is closed</span>
              </span>
              <Button variant="quiet" size="touch" icon={History} aria-label={`History of ${name} of ${r.amount}`} className="min-w-[44px]" onClick={() => act.onHistory(r)} />
            </span>
          )
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="quiet" size="sm" icon={Ellipsis} aria-label={`More for ${name} of ${r.amount}`} />
            </PopoverTrigger>
            <PopoverContent variant="menu" align="end">
              <MenuItem icon={Pencil} onClick={() => act.onEdit(r)}>
                Edit expense
              </MenuItem>
              <MenuItem icon={History} onClick={() => act.onHistory(r)}>
                History
              </MenuItem>
              <MenuItem icon={Trash2} onClick={() => act.onDelete(r)}>
                Delete expense
              </MenuItem>
            </PopoverContent>
          </Popover>
        )
      },
    },
  )
  return cols
}

function ExpenseCard({
  row,
  categories,
  listing,
  locked,
  onEdit,
  onDelete,
  onHistory,
}: {
  row: ListedExpense
  categories: readonly Category[]
  listing: ExpenseListing | undefined
  locked: boolean
  onEdit: (r: ListedExpense) => void
  onDelete: (r: ListedExpense) => void
  onHistory: (r: ListedExpense) => void
}) {
  const d = describe(row, categories, listing)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-[2px] py-1">
      <span className="min-w-0 text-base font-medium [overflow-wrap:anywhere]">{d.name}</span>
      <Money value={row.amount} prefix={false} className="justify-self-end text-right text-base font-medium" />
      {locked ? (
        <Button variant="quiet" size="touch" icon={History} className="row-span-2 min-w-[44px]" aria-label={`History of ${d.name} of ${row.amount}`} onClick={() => onHistory(row)} />
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="quiet" size="touch" icon={Ellipsis} className="row-span-2 min-w-[44px]" aria-label={`More for ${d.name} of ${row.amount}`} />
          </PopoverTrigger>
          <PopoverContent variant="menu" align="end">
            <MenuItem icon={Pencil} onClick={() => onEdit(row)}>
              Edit expense
            </MenuItem>
            <MenuItem icon={History} onClick={() => onHistory(row)}>
              History
            </MenuItem>
            <MenuItem icon={Trash2} onClick={() => onDelete(row)}>
              Delete expense
            </MenuItem>
          </PopoverContent>
        </Popover>
      )}
      <span className="min-w-0 text-sm text-fg-2 [overflow-wrap:anywhere]">{d.detail || ' '}</span>
      <span className="num inline-flex items-center gap-1 justify-self-end text-sm text-fg-muted">
        {locked ? <Icon icon={Lock} size="chip" aria-label="Locked" /> : null}
        {formatShortDate(row.paidOn, businessToday())} · {PAID_VIA_LABEL[row.paidVia]}
      </span>
    </div>
  )
}
