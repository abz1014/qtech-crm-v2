import { useMemo, useState } from 'react'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, FolderInput, FolderPlus, Merge, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useSession } from '@/app/session'
import {
  KIND_WORDS,
  kindNote,
  PAID_VIA_LABEL,
  amountText,
  budgetState,
  categoriesFooter,
  categorySections,
  moveCategory,
  usageText,
  type Category,
  type CategorySection,
  type ExpenseGroup,
  type PaidVia,
} from '@/features/settings/categoriesModel'
import {
  AddCategoryDialog,
  AddGroupDialog,
  BudgetDialog,
  DeleteCategoryDialog,
  DeleteGroupDialog,
  MergeDialog,
  MoveDialog,
  RenameCategoryDialog,
  RenameGroupDialog,
} from '@/features/settings/categories/CategoryDialogs'
import { RowMenu, type RowMenuItem } from '@/features/settings/categories/RowMenu'
import { useCategories, useCategoryMonthTotals, useExpenseGroups, useReorderCategories, useUpdateCategory } from '@/features/settings/hooks'
import type { CategoryPatch } from '@/features/settings/api'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { InfoTip } from '@/ui/InfoTip'
import { PageHeader } from '@/ui/PageHeader'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'

/*
 * Settings › Expense categories (M13; groups, budgets, merge and archive 0084; admin only). Two levels, read-only rows:
 *   group header   name, where it shows in Profit and loss, what it had paid this month, ⋯ (Rename, Delete when empty)
 *   category row   name, how it is usually paid and how often it is used; this month's spend and the budget left or over; ⋯
 * Every change goes through the row's ⋯ (a bottom sheet on a phone): Rename, Move to group, Monthly budget, Usually paid
 * (Cash / Bank), Move up or down, Merge into, Archive (Undo) or Bring back, Delete (only when nothing uses it). A category
 * in use is never deleted: the foreign key is RESTRICT. Archived categories wait, collapsed, at the foot of the page.
 * One green button: Add category. The explanations are behind the (i), not printed (grader M5).
 */
type Open =
  | { kind: 'add'; groupId?: string }
  | { kind: 'add-group' }
  | { kind: 'rename' | 'move' | 'budget' | 'merge' | 'delete'; c: Category }
  | { kind: 'rename-group' | 'delete-group'; g: ExpenseGroup }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function CategoriesPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const month = businessToday().slice(0, 7)
  const monthName = MONTHS[Number(month.slice(5, 7)) - 1]
  const q = useCategories(isAdmin)
  const groupsQ = useExpenseGroups(isAdmin)
  const totalsQ = useCategoryMonthTotals(month, isAdmin)
  const update = useUpdateCategory()
  const reorder = useReorderCategories()
  const { toast } = useToast()
  const phone = useMediaQuery('(max-width: 767px)')
  const [open, setOpen] = useState<Open | null>(null)
  const [announce, setAnnounce] = useState('')

  const rows = useMemo(() => q.data ?? [], [q.data])
  const groups = useMemo(() => groupsQ.data ?? [], [groupsQ.data])
  const totals = useMemo(() => totalsQ.data ?? {}, [totalsQ.data])
  const { sections, archived } = useMemo(() => categorySections(rows, groups, totals), [rows, groups, totals])

  const patch = async (c: Category, p: CategoryPatch, done: string, undo?: CategoryPatch) => {
    try {
      await update.mutateAsync({ id: c.id, patch: p })
      toast({
        title: done,
        body: c.name,
        tone: 'success',
        ...(undo ? { undo: { onUndo: () => update.mutateAsync({ id: c.id, patch: undo }).then(() => undefined) } } : {}),
      })
    } catch (err) {
      toast({ title: `Couldn't change ${c.name}`, body: mapPgError(err, { entity: 'category' }).message, tone: 'danger' })
    }
  }

  const move = async (section: CategorySection, c: Category, dir: -1 | 1) => {
    const changes = moveCategory(section.rows, c.id, dir)
    if (changes.length === 0) return
    try {
      await reorder.mutateAsync(changes)
      const pos = section.rows.findIndex(r => r.id === c.id) + dir + 1
      setAnnounce(`${c.name} moved ${dir < 0 ? 'up' : 'down'} to position ${pos} of ${section.rows.length} in ${section.group.name}.`)
    } catch (err) {
      toast({ title: `Couldn't move ${c.name}`, body: mapPgError(err, { entity: 'category' }).message, tone: 'danger' })
    }
  }

  const categoryItems = (c: Category, section: CategorySection | null): RowMenuItem[] => {
    if (!c.active) {
      return [
        { key: 'restore', label: 'Bring back', icon: ArchiveRestore, onSelect: () => void patch(c, { active: true }, 'Category brought back') },
        { key: 'merge', label: 'Merge into…', icon: Merge, onSelect: () => setOpen({ kind: 'merge', c }) },
        ...(c.used === 0 ? [{ key: 'delete', label: 'Delete', icon: Trash2, danger: true, separated: true, onSelect: () => setOpen({ kind: 'delete', c }) }] : []),
      ]
    }
    const at = section ? section.rows.findIndex(r => r.id === c.id) : -1
    const items: RowMenuItem[] = [
      { key: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setOpen({ kind: 'rename', c }) },
      { key: 'move', label: 'Move to group…', icon: FolderInput, onSelect: () => setOpen({ kind: 'move', c }) },
      { key: 'budget', label: c.monthly_budget_pkr ? 'Change monthly budget…' : 'Set monthly budget…', icon: Target, onSelect: () => setOpen({ kind: 'budget', c }) },
      ...(['cash', 'bank'] as PaidVia[]).map((v, i) => ({
        key: `pay-${v}`,
        label: `Usually paid by ${v === 'cash' ? 'cash' : 'bank'}`,
        checked: c.default_paid_via === v,
        separated: i === 0,
        onSelect: () => (c.default_paid_via === v ? undefined : void patch(c, { default_paid_via: v }, `Usually paid by ${v === 'cash' ? 'cash' : 'bank'} now`)),
      })),
      ...(section && at > 0 ? [{ key: 'up', label: 'Move up', icon: ArrowUp, separated: true, onSelect: () => void move(section, c, -1) }] : []),
      ...(section && at >= 0 && at < section.rows.length - 1 ? [{ key: 'down', label: 'Move down', icon: ArrowDown, separated: at === 0, onSelect: () => void move(section, c, 1) }] : []),
      { key: 'merge', label: 'Merge into…', icon: Merge, separated: true, onSelect: () => setOpen({ kind: 'merge', c }) },
      { key: 'archive', label: 'Archive', icon: Archive, onSelect: () => void patch(c, { active: false }, 'Category archived', { active: true }) },
    ]
    if (c.used === 0) items.push({ key: 'delete', label: 'Delete', icon: Trash2, danger: true, separated: true, onSelect: () => setOpen({ kind: 'delete', c }) })
    return items
  }

  const groupItems = (s: CategorySection): RowMenuItem[] => [
    { key: 'add', label: 'Add a category here', icon: Plus, onSelect: () => setOpen({ kind: 'add', groupId: s.group.id }) },
    { key: 'rename', label: 'Rename group', icon: Pencil, onSelect: () => setOpen({ kind: 'rename-group', g: s.group }) },
    ...(s.held === 0 ? [{ key: 'delete', label: 'Delete group', icon: Trash2, danger: true, separated: true, onSelect: () => setOpen({ kind: 'delete-group', g: s.group }) }] : []),
  ]

  const loading = q.isPending || groupsQ.isPending
  const failed = q.isError || groupsQ.isError

  return (
    <div className="grid content-start gap-6">
      <PageHeader
        title="Expense categories"
        lede={
          <>
            Every expense goes under a category, and every category under a group.{' '}
            <InfoTip label="About categories">
              <p>A category in use is never deleted: past expenses point to it. Archive it to stop offering it for new expenses (the old ones keep it), or merge it into another category to move its expenses there.</p>
              <p className="mt-2">The group decides where spending shows in Profit and loss: running costs, order costs, or not a cost (owner drawings and loan repayments).</p>
              <p className="mt-2">A budget is a monthly limit for one category, compared with what was paid that month.</p>
            </InfoTip>
          </>
        }
        secondary={
          <Button icon={FolderPlus} onClick={() => setOpen({ kind: 'add-group' })} disabled={loading || failed}>
            Add group
          </Button>
        }
        primary={
          <Button variant="primary" icon={Plus} onClick={() => setOpen({ kind: 'add' })} disabled={loading || failed}>
            Add category
          </Button>
        }
      />

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {failed ? (
        <Banner
          tone="danger"
          title="Could not load the categories"
          action={
            <Button
              size="sm"
              onClick={() => {
                void q.refetch()
                void groupsQ.refetch()
              }}
            >
              Try again
            </Button>
          }
        >
          Check your connection, then try again.
        </Banner>
      ) : loading ? (
        <div role="status" className="grid gap-px overflow-hidden rounded border bg-line" aria-busy="true" aria-label="Loading categories">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-surface p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="-mb-3 text-sm text-fg-muted">Amounts are what was paid in {monthName}, cash and bank together.</p>
          {sections.map(s => (
            <GroupSection key={s.group.id} s={s} phone={phone} totals={totals} groupItems={groupItems(s)} itemsFor={c => categoryItems(c, s)} onAdd={() => setOpen({ kind: 'add', groupId: s.group.id })} />
          ))}
          {archived.length > 0 ? (
            <details className="group/arch rounded border bg-surface">
              <summary className="flex min-h-touch cursor-pointer items-center gap-2 px-4 text-base font-medium text-fg-2 [&::-webkit-details-marker]:hidden">
                <Icon16 />
                Archived ({archived.length})
                <span className="text-sm font-normal text-fg-muted">hidden from new expenses</span>
              </summary>
              <ul aria-label="Archived categories" className="border-t">
                {archived.map(c => (
                  <CategoryRow key={c.id} c={c} spent={totals[c.id] ?? 0} groupName={groups.find(g => g.id === c.group_id)?.name} phone={phone} items={categoryItems(c, null)} />
                ))}
              </ul>
            </details>
          ) : null}
          <p className="text-sm text-fg-muted" data-testid="categories-footer">
            {categoriesFooter(rows)} · {groups.length} {groups.length === 1 ? 'group' : 'groups'}
          </p>
        </>
      )}

      {open?.kind === 'add' ? <AddCategoryDialog rows={rows} groups={groups} initialGroupId={open.groupId} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'add-group' ? <AddGroupDialog groups={groups} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'rename' ? <RenameCategoryDialog c={open.c} rows={rows} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'move' ? <MoveDialog c={open.c} rows={rows} groups={groups} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'budget' ? <BudgetDialog c={open.c} spent={totals[open.c.id] ?? 0} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'merge' ? <MergeDialog c={open.c} rows={rows} groups={groups} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'delete' ? <DeleteCategoryDialog c={open.c} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'rename-group' ? <RenameGroupDialog g={open.g} groups={groups} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'delete-group' ? <DeleteGroupDialog g={open.g} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

/** The disclosure triangle of the archived list (turns when open). */
function Icon16() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0 text-fg-muted transition-transform duration-fast group-open/arch:rotate-90">
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GroupSection({
  s,
  phone,
  totals,
  groupItems,
  itemsFor,
  onAdd,
}: {
  s: CategorySection
  phone: boolean
  totals: Readonly<Record<string, number>>
  groupItems: RowMenuItem[]
  itemsFor: (c: Category) => RowMenuItem[]
  onAdd: () => void
}) {
  const headId = `grp-${s.group.id}`
  return (
    <section aria-labelledby={headId} data-group={s.group.name} className="overflow-hidden rounded border bg-surface">
      <header className="flex items-center gap-3 border-b bg-sunken py-2 pl-4 pr-1">
        <div className="grid min-w-0 flex-1">
          <h2 id={headId} className="min-w-0 text-lg font-semibold tracking-snug [overflow-wrap:anywhere]">
            {s.group.name}
          </h2>
          {kindNote(s.group) ? <span className="text-sm text-fg-muted">{kindNote(s.group)}</span> : null}
        </div>
        <div className="grid justify-items-end text-right">
          <span className="num text-base font-medium" data-testid="group-total">
            PKR {amountText(s.monthTotal)}
          </span>
          <span className="text-sm text-fg-muted">this month</span>
        </div>
        <RowMenu label={`More for the group ${s.group.name}`} title={s.group.name} subtitle={KIND_WORDS[s.group.kind]} items={groupItems} phone={phone} />
      </header>
      {s.rows.length === 0 ? (
        <div className="flex min-h-touch items-center gap-3 px-4 py-2 text-base text-fg-muted">
          <span className="flex-1">{s.held > 0 ? 'Every category here is archived.' : 'No categories yet.'}</span>
          <Button variant="quiet" icon={Plus} onClick={onAdd}>
            Add one
          </Button>
        </div>
      ) : (
        <ul aria-label={`${s.group.name} categories`}>
          {s.rows.map(c => (
            <CategoryRow key={c.id} c={c} spent={totals[c.id] ?? 0} phone={phone} items={itemsFor(c)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function CategoryRow({ c, spent, phone, items, groupName }: { c: Category; spent: number; phone: boolean; items: RowMenuItem[]; groupName?: string }) {
  const b = budgetState(spent, c.monthly_budget_pkr)
  const meta = [groupName, `Usually ${PAID_VIA_LABEL[c.default_paid_via].toLowerCase()}`, usageText(c.used)].filter(Boolean).join(' · ')
  return (
    <li data-category={c.name} className={cn('grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 border-b py-2 pl-4 pr-1 last:border-b-0', !c.active && 'bg-canvas')}>
      <div className="grid min-w-0">
        <span className={cn('min-w-0 text-base font-medium [overflow-wrap:anywhere]', !c.active && 'text-fg-2')}>{c.name}</span>
        <span className="min-w-0 text-sm text-fg-muted" data-testid="usage">
          {groupName ? <span className="whitespace-nowrap">{groupName} · </span> : null}
          <span className="whitespace-nowrap">{phone ? PAID_VIA_LABEL[c.default_paid_via] : `Usually ${PAID_VIA_LABEL[c.default_paid_via].toLowerCase()}`} · </span>
          <span className="whitespace-nowrap">{usageText(c.used)}</span>
        </span>
      </div>
      <div className="grid justify-items-end text-right">
        <span className={cn('num text-base', spent > 0 ? 'text-fg' : 'text-fg-muted')} data-testid="spent">
          {spent > 0 ? amountText(spent) : '—'}
          <span className="sr-only">{spent > 0 ? ' PKR this month' : 'nothing paid this month'}</span>
        </span>
        {b.kind === 'over' ? (
          <span className="num text-sm font-medium text-tone-warning-fg" data-testid="budget">
            {amountText(b.over)} over budget
          </span>
        ) : b.kind === 'under' ? (
          <span className="num text-sm text-fg-muted" data-testid="budget">
            {amountText(b.left)} left of {amountText(b.budget)}
          </span>
        ) : null}
      </div>
      <RowMenu label={`More for ${c.name}`} title={c.name} subtitle={meta} items={items} phone={phone} />
    </li>
  )
}
