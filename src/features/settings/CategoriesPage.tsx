import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useSession } from '@/app/session'
import {
  checkCategoryName,
  deleteAdvice,
  GROUP_LABEL,
  moveCategory,
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
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/useToast'
import { Checkbox } from '@/ui/form/Checkbox'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'

/*
 * Settings › Expense categories (M13, admin only). Rename, reorder (up and down), activate or deactivate, change the
 * group and the default paid-via. Expenses point at a category with a RESTRICT foreign key, so a category that is in use
 * can never be deleted: the page says so in words and offers Deactivate, which hides it from new expenses and leaves the
 * old ones alone. The usage count is expenses plus recurring templates.
 */
const GROUPS: CategoryGroup[] = ['overhead', 'order_cost', 'non_pnl']
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

  const rows = useMemo(() => sortCategories(q.data ?? []), [q.data])
  const fail = (title: string, err: unknown) => toast({ title, body: mapPgError(err, { entity: 'category' }).message, tone: 'danger' })

  const patch = async (c: Category, p: CategoryPatch, done?: string) => {
    try {
      await update.mutateAsync({ id: c.id, patch: p })
      if (done) toast({ title: done, body: c.name, tone: 'success' })
    } catch (err) {
      fail(`Couldn't change ${c.name}`, err)
    }
  }

  const move = async (c: Category, dir: -1 | 1) => {
    const changes = moveCategory(rows, c.id, dir)
    if (changes.length === 0) return
    try {
      await reorder.mutateAsync(changes)
      const pos = rows.findIndex(r => r.id === c.id) + dir + 1
      setAnnounce(`${c.name} moved ${dir < 0 ? 'up' : 'down'} to position ${pos} of ${rows.length}.`)
    } catch (err) {
      fail(`Couldn't move ${c.name}`, err)
    }
  }

  return (
    <div className="grid content-start gap-4">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Expense categories</h1>
        <p className="max-w-prose text-sm text-fg-muted">
          What an expense can be filed under. The order here is the order expenses offer them in; the group decides where reports place them.
        </p>
      </header>

      <Banner tone="info" title="Categories in use cannot be deleted">
        Past expenses point to them. Deactivate a category instead: it stops showing up for new expenses and the old ones keep it.
      </Banner>

      <AddCategory rows={rows} />

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {q.isError ? (
        <Banner tone="danger" title="Could not load the categories" action={<Button size="sm" onClick={() => void q.refetch()}>Try again</Button>}>
          {q.error instanceof Error ? q.error.message : 'Check your connection, then try again.'}
        </Banner>
      ) : q.isPending ? (
        <div className="grid gap-px overflow-hidden rounded border bg-line" aria-busy="true" aria-label="Loading categories">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-surface p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <ul aria-label="Expense categories" className="overflow-hidden rounded border bg-surface">
          {rows.map((c, i) => (
            <CategoryRow
              key={c.id}
              c={c}
              all={rows}
              first={i === 0}
              last={i === rows.length - 1}
              busy={reorder.isPending}
              asking={asking === c.id}
              onAsk={open => setAsking(open ? c.id : null)}
              onMove={dir => void move(c, dir)}
              onPatch={(p, done) => patch(c, p, done)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function AddCategory({ rows }: { rows: readonly Category[] }) {
  const create = useCreateCategory()
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [grp, setGrp] = useState<CategoryGroup>('overhead')
  const [paid, setPaid] = useState<PaidVia>('bank')
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const check = checkCategoryName(name, rows)
    if (!check.ok) return setError(check.message)
    try {
      await create.mutateAsync({ name: check.name, grp, default_paid_via: paid, sort: nextSort(rows) })
      toast({ title: 'Category added', body: check.name, tone: 'success' })
      setName('')
      setError(null)
      nameRef.current?.focus()
    } catch (err) {
      const m = mapPgError(err, { entity: 'category' })
      setError(m.kind === 'unique' ? 'A category with this name already exists.' : m.message)
    }
  }

  return (
    <form onSubmit={e => void submit(e)} noValidate aria-label="Add a category" className="grid items-start gap-3 rounded border bg-sunken p-3 md:grid-cols-[minmax(0,1fr)_170px_130px_auto]">
      <Field label="New category" error={error ?? undefined}>
        <TextField
          ref={nameRef}
          value={name}
          placeholder="Name"
          maxLength={60}
          onChange={e => {
            setName(e.target.value)
            setError(null)
          }}
        />
      </Field>
      <Field label="Group">
        <Select value={grp} onChange={e => setGrp(e.target.value as CategoryGroup)} options={GROUP_OPTIONS} />
      </Field>
      <Field label="Paid via">
        <Select value={paid} onChange={e => setPaid(e.target.value as PaidVia)} options={PAID_OPTIONS} />
      </Field>
      <div className="md:pt-[26px]">
        <Button type="submit" variant="primary" icon={Plus} busy={create.isPending} busyLabel="Adding" className="max-md:w-full">
          Add category
        </Button>
      </div>
    </form>
  )
}

interface RowProps {
  c: Category
  all: readonly Category[]
  first: boolean
  last: boolean
  busy: boolean
  asking: boolean
  onAsk: (open: boolean) => void
  onMove: (dir: -1 | 1) => void
  onPatch: (p: CategoryPatch, done?: string) => Promise<void>
}

function CategoryRow({ c, all, first, last, busy, asking, onAsk, onMove, onPatch }: RowProps) {
  const del = useDeleteCategory()
  const { toast } = useToast()
  const [name, setName] = useState(c.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const advice = deleteAdvice(c)

  // Follow the saved name when it changes elsewhere, but never while it is being typed.
  const lastSaved = useRef(c.name)
  if (lastSaved.current !== c.name) {
    lastSaved.current = c.name
    if (name !== c.name) setName(c.name)
  }

  const saveName = async () => {
    if (name === c.name) return setNameError(null)
    const check = checkCategoryName(name, all, c.id)
    if (!check.ok) return setNameError(check.message)
    setNameError(null)
    await onPatch({ name: check.name }, 'Category renamed')
  }

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

  const idBase = `cat-${c.id}`
  return (
    <li data-category={c.name} className={cn('grid gap-3 border-b px-3 py-3 last:border-b-0', !c.active && 'bg-sunken')}>
      <div className="grid items-start gap-3 md:grid-cols-[64px_minmax(0,1fr)_150px_110px_120px_auto]">
        <div className="flex gap-1">
          <Button icon={ArrowUp} variant="quiet" className="max-md:size-touch" aria-label={`Move ${c.name} up`} disabled={first || busy} onClick={() => onMove(-1)} />
          <Button icon={ArrowDown} variant="quiet" className="max-md:size-touch" aria-label={`Move ${c.name} down`} disabled={last || busy} onClick={() => onMove(1)} />
        </div>
        <div className="grid min-w-0 gap-1">
          <TextField
            aria-label={`Name of ${c.name}`}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${idBase}-err` : undefined}
            value={name}
            maxLength={60}
            onChange={e => {
              setName(e.target.value)
              setNameError(null)
            }}
            onBlur={() => void saveName()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void saveName()
              } else if (e.key === 'Escape') {
                setName(c.name)
                setNameError(null)
              }
            }}
          />
          {nameError ? (
            <p id={`${idBase}-err`} role="alert" className="text-xs text-tone-danger-fg">
              {nameError}
            </p>
          ) : null}
        </div>
        <Select
          aria-label={`Group of ${c.name}`}
          value={c.grp}
          options={GROUP_OPTIONS}
          onChange={e => void onPatch({ grp: e.target.value as CategoryGroup }, 'Group changed')}
        />
        <Select
          aria-label={`Default paid via for ${c.name}`}
          value={c.default_paid_via}
          options={PAID_OPTIONS}
          onChange={e => void onPatch({ default_paid_via: e.target.value as PaidVia }, 'Paid via changed')}
        />
        <p className="num flex h-control items-center text-sm text-fg-muted" data-testid="usage">
          {usageText(c.used)}
        </p>
        <div className="flex h-control items-center justify-between gap-3 max-md:min-h-touch md:justify-end">
          <Checkbox
            aria-label={`${c.name} is active`}
            label="Active"
            checked={c.active}
            onCheckedChange={v => void onPatch({ active: v === true }, v === true ? 'Category activated' : 'Category deactivated')}
          />
          <Button icon={Trash2} variant="quiet" className="max-md:size-touch" aria-label={`Delete ${c.name}`} aria-expanded={asking} onClick={() => onAsk(!asking)} />
        </div>
      </div>
      {!c.active ? (
        <p className="md:pl-[76px]">
          <Tag dashed>Inactive: hidden from new expenses</Tag>
        </p>
      ) : null}
      {asking ? (
        <div role="group" aria-label={`Delete ${c.name}`} className="flex flex-wrap items-center gap-3 rounded border bg-surface px-3 py-2 text-sm md:ml-[76px]">
          <p className="min-w-0 flex-1 text-pretty">{advice.message}</p>
          {advice.canDelete ? (
            <Button variant="danger" icon={Trash2} busy={del.isPending} busyLabel="Deleting" onClick={() => void remove()}>
              Delete
            </Button>
          ) : c.active ? (
            <Button variant="primary" onClick={() => void onPatch({ active: false }, 'Category deactivated').then(() => onAsk(false))}>
              Deactivate
            </Button>
          ) : null}
          <Button onClick={() => onAsk(false)}>{advice.canDelete ? 'Cancel' : 'Close'}</Button>
        </div>
      ) : null}
    </li>
  )
}
