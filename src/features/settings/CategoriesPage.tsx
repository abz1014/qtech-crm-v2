import { useId, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Ellipsis, EyeOff, Eye, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { useSession } from '@/app/session'
import {
  categoriesFooter,
  checkCategoryName,
  deleteAdvice,
  GROUP_LABEL,
  GROUPS,
  groupCategories,
  moveWithinGroup,
  nextSort,
  PAID_VIA_LABEL,
  sortCategories,
  usageText,
  type Category,
  type CategoryGroup,
  type PaidVia,
} from '@/features/settings/categoriesModel'
import { useCategories, useCreateCategory, useDeleteCategory, useReorderCategories, useUpdateCategory } from '@/features/settings/hooks'
import type { CategoryPatch } from '@/features/settings/api'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { InfoTip } from '@/ui/InfoTip'
import { PageHeader } from '@/ui/PageHeader'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'

/*
 * Settings › Expense categories (M13, admin only). Expenses point at a category with a RESTRICT foreign key, so a category
 * that is in use can never be deleted: Deactivate hides it from new expenses and leaves the old ones alone. The usage count
 * is expenses plus recurring templates.
 *
 * Audit 2026-10-22 (was 68 always-editable controls, 6,731 px on a phone): read-only rows in three sections by group
 * (Overheads, Order costs, Not in P&L), each row "Name / Paid via bank · 14 uses" with one ⋯ menu (Edit, Move up, Move down,
 * Deactivate or Reactivate). The trash button is only on a row nothing uses; the "cannot be deleted" rule sits in the (i).
 * "Add category" is the page's one green button and opens a small dialog; Edit opens the same dialog filled in.
 */
const GROUP_OPTIONS = GROUPS.map(g => ({ value: g, label: GROUP_LABEL[g] }))
const PAID_OPTIONS = (['bank', 'cash'] as PaidVia[]).map(p => ({ value: p, label: PAID_VIA_LABEL[p] }))

export function CategoriesPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const q = useCategories(isAdmin)
  const update = useUpdateCategory()
  const reorder = useReorderCategories()
  const { toast } = useToast()
  const [announce, setAnnounce] = useState('')
  const [asking, setAsking] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ kind: 'add' } | { kind: 'edit'; c: Category } | null>(null)

  const rows = useMemo(() => sortCategories(q.data ?? []), [q.data])
  const groups = useMemo(() => groupCategories(rows), [rows])
  const fail = (title: string, err: unknown) => toast({ title, body: mapPgError(err, { entity: 'category' }).message, tone: 'danger' })

  const patch = async (c: Category, p: CategoryPatch, done?: string) => {
    try {
      await update.mutateAsync({ id: c.id, patch: p })
      if (done) toast({ title: done, body: c.name, tone: 'success' })
      return true
    } catch (err) {
      fail(`Couldn't change ${c.name}`, err)
      return false
    }
  }

  const move = async (c: Category, dir: -1 | 1) => {
    const changes = moveWithinGroup(rows, c.id, dir)
    if (changes.length === 0) return
    try {
      await reorder.mutateAsync(changes)
      const inGroup = rows.filter(r => r.grp === c.grp)
      const pos = inGroup.findIndex(r => r.id === c.id) + dir + 1
      setAnnounce(`${c.name} moved ${dir < 0 ? 'up' : 'down'} to position ${pos} of ${inGroup.length} in ${GROUP_LABEL[c.grp]}.`)
    } catch (err) {
      fail(`Couldn't move ${c.name}`, err)
    }
  }

  return (
    <div className="grid content-start gap-4">
      <PageHeader
        title="Expense categories"
        lede={
          <>
            What an expense can be filed under, in the order expenses offer them.{' '}
            <InfoTip label="About categories">
              The group decides where reports place a category. A category in use cannot be deleted, because past expenses point to it:
              deactivate it instead, and it stops showing up for new expenses while the old ones keep it.
            </InfoTip>
          </>
        }
        primary={
          isAdmin ? (
            <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: 'add' })} disabled={q.isPending || q.isError}>
              Add category
            </Button>
          ) : undefined
        }
      />

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {q.isError ? (
        <Banner tone="danger" title="Could not load the categories" action={<Button size="sm" onClick={() => void q.refetch()}>Try again</Button>}>
          {q.error instanceof Error ? q.error.message : 'Check your connection, then try again.'}
        </Banner>
      ) : q.isPending ? (
        <div role="status" className="grid gap-px overflow-hidden rounded border bg-line" aria-busy="true" aria-label="Loading categories">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-surface p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4" data-testid="categories">
          {groups.map(g => (
            <Group key={g.grp} label={g.label}>
              {g.rows.map((c, i) => (
                <CategoryRow
                  key={c.id}
                  c={c}
                  first={i === 0}
                  last={i === g.rows.length - 1}
                  busy={reorder.isPending}
                  asking={asking === c.id}
                  onAsk={open => setAsking(open ? c.id : null)}
                  onMove={dir => void move(c, dir)}
                  onEdit={() => setDialog({ kind: 'edit', c })}
                  onPatch={(p, done) => patch(c, p, done)}
                />
              ))}
            </Group>
          ))}
        </div>
      )}
      {q.data ? (
        <p className="text-sm text-fg-muted" data-testid="categories-footer">
          {categoriesFooter(q.data)}
        </p>
      ) : null}

      {dialog ? (
        <CategoryDialog
          rows={rows}
          editing={dialog.kind === 'edit' ? dialog.c : null}
          onClose={() => setDialog(null)}
          onPatch={(c, p) => patch(c, p, 'Category saved')}
        />
      ) : null}
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded border bg-surface">
      <h2 id={id} className="border-b bg-sunken px-4 py-2 text-base font-semibold">
        {label}
      </h2>
      <ul aria-labelledby={id}>{children}</ul>
    </section>
  )
}

interface RowProps {
  c: Category
  first: boolean
  last: boolean
  busy: boolean
  asking: boolean
  onAsk: (open: boolean) => void
  onMove: (dir: -1 | 1) => void
  onEdit: () => void
  onPatch: (p: CategoryPatch, done?: string) => Promise<boolean>
}

function CategoryRow({ c, first, last, busy, asking, onAsk, onMove, onEdit, onPatch }: RowProps) {
  const del = useDeleteCategory()
  const { toast } = useToast()
  const advice = deleteAdvice(c)
  const unused = c.used === 0

  const remove = async () => {
    try {
      await del.mutateAsync(c.id)
      onAsk(false)
      toast({ title: 'Category deleted', body: c.name, tone: 'success' })
    } catch (err) {
      // Something started using it since the page loaded: the foreign key refused, so say what to do instead.
      const m = mapPgError(err, { entity: 'category' })
      toast({
        title: `Couldn't delete ${c.name}`,
        body: m.kind === 'reference-in-use' ? 'It is in use, so it cannot be deleted. Deactivate it instead.' : m.message,
        tone: 'danger',
      })
    }
  }

  const toggle = () => void onPatch({ active: !c.active }, c.active ? 'Category deactivated' : 'Category activated')

  return (
    <li data-category={c.name} className={cn('grid gap-2 border-b px-4 py-2 last:border-b-0', !c.active && 'bg-sunken')}>
      <div className="flex min-h-touch items-center gap-2">
        <div className="grid min-w-0 flex-1">
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{c.name}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
            <span>Paid via {PAID_VIA_LABEL[c.default_paid_via].toLowerCase()}</span>
            <span aria-hidden="true">·</span>
            <span className="num" data-testid="usage">
              {usageText(c.used)}
            </span>
            {c.active ? null : <Tag dashed>Inactive: hidden from new expenses</Tag>}
          </span>
        </div>
        {unused ? (
          <Button
            icon={Trash2}
            variant="quiet"
            size="sm"
            className="max-md:h-touch max-md:w-touch"
            aria-label={`Delete ${c.name}`}
            aria-expanded={asking}
            onClick={() => onAsk(!asking)}
          />
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="quiet" size="sm" icon={Ellipsis} className="max-md:h-touch max-md:w-touch" aria-label={`More for ${c.name}`} />
          </PopoverTrigger>
          <PopoverContent variant="menu" align="end" aria-label={`More for ${c.name}`}>
            <MenuItem icon={Pencil} onClick={onEdit}>
              Edit name, group or paid via
            </MenuItem>
            <MenuItem icon={ArrowUp} disabled={first || busy} onClick={() => onMove(-1)}>
              Move up
            </MenuItem>
            <MenuItem icon={ArrowDown} disabled={last || busy} onClick={() => onMove(1)}>
              Move down
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={c.active ? EyeOff : Eye} onClick={toggle}>
              {c.active ? 'Deactivate' : 'Reactivate'}
            </MenuItem>
          </PopoverContent>
        </Popover>
      </div>
      {asking && advice.canDelete ? (
        <div role="group" aria-label={`Delete ${c.name}`} className="flex flex-wrap items-center gap-3 rounded border bg-surface px-3 py-2 text-sm">
          <p className="min-w-0 flex-1 text-pretty">{advice.message}</p>
          <Button variant="danger" icon={Trash2} busy={del.isPending} busyLabel="Deleting" onClick={() => void remove()}>
            Delete
          </Button>
          <Button onClick={() => onAsk(false)}>Cancel</Button>
        </div>
      ) : null}
    </li>
  )
}

/** Add a category, or edit one (the same three fields, filled in). Only what changed is saved. */
function CategoryDialog({
  rows,
  editing,
  onClose,
  onPatch,
}: {
  rows: readonly Category[]
  editing: Category | null
  onClose: () => void
  onPatch: (c: Category, p: CategoryPatch) => Promise<boolean>
}) {
  const create = useCreateCategory()
  const { toast } = useToast()
  const formId = useId()
  const [name, setName] = useState(editing?.name ?? '')
  const [grp, setGrp] = useState<CategoryGroup>(editing?.grp ?? 'overhead')
  const [paid, setPaid] = useState<PaidVia>(editing?.default_paid_via ?? 'bank')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dirty = editing ? name !== editing.name || grp !== editing.grp || paid !== editing.default_paid_via : name.trim() !== ''

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const check = checkCategoryName(name, rows, editing?.id)
    if (!check.ok) return setError(check.message)
    setSaving(true)
    try {
      if (editing) {
        const p: CategoryPatch = {}
        if (check.name !== editing.name) p.name = check.name
        if (grp !== editing.grp) p.grp = grp
        if (paid !== editing.default_paid_via) p.default_paid_via = paid
        if (Object.keys(p).length === 0 || (await onPatch(editing, p))) onClose()
      } else {
        await create.mutateAsync({ name: check.name, grp, default_paid_via: paid, sort: nextSort(rows) })
        toast({ title: 'Category added', body: check.name, tone: 'success' })
        onClose()
      }
    } catch (err) {
      const m = mapPgError(err, { entity: 'category' })
      setError(m.kind === 'unique' ? 'A category with this name already exists.' : m.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && !saving && onClose()} busy={saving} dirty={dirty}>
      <DialogContent
        title={editing ? `Edit ${editing.name}` : 'Add category'}
        icon={Receipt}
        size="sm"
        footer={
          <>
            <Button data-cancel disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={formId} icon={editing ? undefined : Plus} busy={saving} busyLabel="Saving">
              {editing ? 'Save category' : 'Add category'}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={e => void submit(e)} noValidate className="grid gap-4">
          <Field label="Name" error={error ?? undefined}>
            <TextField
              value={name}
              maxLength={60}
              autoComplete="off"
              onChange={e => {
                setName(e.target.value)
                setError(null)
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="Group">
              <Select value={grp} onChange={e => setGrp(e.target.value as CategoryGroup)} options={GROUP_OPTIONS} />
            </Field>
            <Field label="Paid via">
              <Select value={paid} onChange={e => setPaid(e.target.value as PaidVia)} options={PAID_OPTIONS} />
            </Field>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
