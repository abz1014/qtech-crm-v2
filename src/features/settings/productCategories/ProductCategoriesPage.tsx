import { useMemo, useState } from 'react'
import { BadgeCheck, Merge, Pencil, Search, Sparkles } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Field } from '@/ui/form/Field'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { InfoTip } from '@/ui/InfoTip'
import { PageHeader } from '@/ui/PageHeader'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { RowMenu, type RowMenuItem } from '@/features/settings/categories/RowMenu'
import type { ProductCategory } from '@/features/settings/productCategories/api'
import { FillDialog } from '@/features/settings/productCategories/FillDialog'
import { useMergeProductCategories, useProductCategories, useRenameProductCategory, useSetProductCategoryCurated } from '@/features/settings/productCategories/hooks'
import { categoryNameError, filterCategories, mergeSentence, type CategoryView } from '@/features/settings/productCategories/model'

/*
 * Settings > Product categories (C4, C5; admin only). The categories an item belongs to; they decide who is suggested when prices are
 * asked for ("Deals in contactors"). Not the Expense categories page. Each row: the name, Curated or not, how many suppliers are
 * tagged with it; its menu: Rename, Merge into, Mark curated. The page's one green button is Fill missing categories.
 * Curated categories are the canonical ones the app suggests; the imported families that are not curated stay out of the way until
 * someone curates or merges them.
 */
type Open = { kind: 'rename' | 'merge'; c: ProductCategory } | { kind: 'fill' }

const VIEWS: ReadonlyArray<{ value: CategoryView; label: string }> = [
  { value: 'curated', label: 'Curated' },
  { value: 'other', label: 'Others' },
  { value: 'all', label: 'All' },
]
const SHOWN_MAX = 200

export function ProductCategoriesPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const q = useProductCategories(isAdmin)
  const curate = useSetProductCategoryCurated()
  const { toast } = useToast()
  const phone = useMediaQuery('(max-width: 767px)')
  const [open, setOpen] = useState<Open | null>(null)
  const [view, setView] = useState<CategoryView>('curated')
  const [text, setText] = useState('')
  const rows = useMemo(() => q.data ?? [], [q.data])
  const shown = useMemo(() => filterCategories(rows, view, text), [rows, view, text])
  const curatedCount = rows.filter(r => r.curated).length

  const toggleCurated = async (c: ProductCategory) => {
    try {
      await curate.mutateAsync({ id: c.id, curated: !c.curated })
      toast({
        title: c.curated ? 'No longer curated' : 'Marked curated',
        body: c.name,
        tone: 'success',
        undo: { onUndo: () => curate.mutateAsync({ id: c.id, curated: c.curated }).then(() => undefined) },
      })
    } catch (err) {
      toast({ title: `Couldn't change ${c.name}`, body: mapPgError(err, { entity: 'category' }).message, tone: 'danger' })
    }
  }

  const itemsFor = (c: ProductCategory): RowMenuItem[] => [
    { key: 'rename', label: 'Rename', icon: Pencil, onSelect: () => setOpen({ kind: 'rename', c }) },
    { key: 'merge', label: 'Merge into…', icon: Merge, onSelect: () => setOpen({ kind: 'merge', c }) },
    { key: 'curate', label: c.curated ? 'Remove from curated' : 'Mark curated', icon: BadgeCheck, separated: true, onSelect: () => void toggleCurated(c) },
  ]

  return (
    <div className="grid content-start gap-6">
      <PageHeader
        title="Product categories"
        lede={
          <>
            What kind of product an item is. It decides who is suggested when you ask for prices.{' '}
            <InfoTip label="About product categories">
              <p>Curated categories are the ones the app suggests and the dictionary fills in. Other families came from the old CRM and stay out of the way until you curate or merge them.</p>
              <p className="mt-2">Merging moves every item, order line and supplier tag onto the category you keep, then removes the other one.</p>
            </InfoTip>
          </>
        }
        primary={
          <Button variant="primary" icon={Sparkles} onClick={() => setOpen({ kind: 'fill' })} disabled={!isAdmin || q.isPending}>
            Fill missing categories
          </Button>
        }
      />

      {q.isError ? (
        <Banner tone="danger" title="Could not load the categories" action={<Button size="sm" onClick={() => void q.refetch()}>Try again</Button>}>
          Check your connection, then try again.
        </Banner>
      ) : q.isPending ? (
        <div role="status" className="grid gap-px overflow-hidden rounded-panel border bg-line" aria-busy="true" aria-label="Loading product categories">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-surface p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl aria-label="Show" value={view} onValueChange={v => setView(v as CategoryView)} options={VIEWS} />
            <div className="relative min-w-[14rem] flex-1 md:max-w-[22rem]">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
              <TextField aria-label="Search product categories" placeholder="Search" className="pl-10" value={text} onChange={e => setText(e.target.value)} />
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="rounded-panel border bg-surface p-4 text-base text-fg-muted">{text ? 'No category matches.' : view === 'curated' ? 'No curated category yet.' : 'Nothing here.'}</p>
          ) : (
            <ul aria-label="Product categories" className="overflow-hidden rounded-panel border bg-surface">
              {shown.slice(0, SHOWN_MAX).map(c => (
                <li key={c.id} className="flex min-h-[56px] items-center gap-3 border-t px-4 py-2 first:border-t-0" data-curated={c.curated || undefined}>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium [overflow-wrap:anywhere]">{c.name}</p>
                    <p className="text-base text-fg-muted">
                      {c.curated ? 'Curated' : 'Not curated'} · {c.suppliers} {c.suppliers === 1 ? 'supplier' : 'suppliers'}
                    </p>
                  </div>
                  <RowMenu label={`More for ${c.name}`} title={c.name} subtitle={c.curated ? 'Curated category' : 'Not curated'} items={itemsFor(c)} phone={phone} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-base text-fg-muted" data-testid="product-categories-footer">
            {shown.length > SHOWN_MAX ? `Showing ${SHOWN_MAX} of ${shown.length}. Search to narrow it. ` : ''}
            {curatedCount} curated · {rows.length - curatedCount} others
          </p>
        </>
      )}

      {open?.kind === 'rename' ? <RenameDialog c={open.c} rows={rows} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'merge' ? <MergeDialog c={open.c} rows={rows} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'fill' ? <FillDialog families={rows.filter(r => r.curated).map(r => ({ id: r.id, name: r.name }))} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

function RenameDialog({ c, rows, onClose }: { c: ProductCategory; rows: readonly ProductCategory[]; onClose: () => void }) {
  const rename = useRenameProductCategory()
  const { toast } = useToast()
  const [name, setName] = useState(c.name)
  const [error, setError] = useState<string | null>(null)
  const problem = categoryNameError(name, rows, c.id)
  const save = async () => {
    if (problem) return setError(problem)
    try {
      await rename.mutateAsync({ id: c.id, name })
      toast({ title: 'Category renamed', body: name.trim(), tone: 'success' })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'category' }).message)
    }
  }
  return (
    <Dialog open busy={rename.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        size="sm"
        title="Rename category"
        context="The new name shows everywhere it is used."
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={rename.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={rename.isPending} busyLabel="Saving" disabled={name.trim() === c.name || name.trim() === ''} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <form
          className="grid gap-4"
          onSubmit={e => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label="Name">
            <TextField
              data-autofocus
              value={name}
              onChange={e => {
                setError(null)
                setName(e.target.value)
              }}
            />
          </Field>
          {error ? <Banner tone="danger" title="Nothing was changed">{error}</Banner> : null}
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MergeDialog({ c, rows, onClose }: { c: ProductCategory; rows: readonly ProductCategory[]; onClose: () => void }) {
  const merge = useMergeProductCategories()
  const { toast } = useToast()
  const others = useMemo(() => rows.filter(r => r.id !== c.id).sort((a, b) => Number(b.curated) - Number(a.curated) || a.name.localeCompare(b.name)), [rows, c.id])
  const [into, setInto] = useState(others.find(o => o.curated)?.id ?? others[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const target = others.find(o => o.id === into)
  const submit = async () => {
    if (!target) return
    setError(null)
    try {
      await merge.mutateAsync({ keep: target.id, drop: c.id })
      toast({ title: 'Categories merged', body: `${c.name} is now ${target.name}`, tone: 'success' })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'category' }).message)
    }
  }
  return (
    <Dialog open busy={merge.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        size="sm"
        title={`Merge ${c.name}`}
        context="Use this when two categories mean the same thing."
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={merge.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={merge.isPending} busyLabel="Merging" disabled={!target} onClick={() => void submit()}>
              Merge
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Merge into">
            <Select data-autofocus value={into} onChange={e => setInto(e.target.value)} options={others.map(o => ({ value: o.id, label: o.curated ? o.name : `${o.name} (not curated)` }))} />
          </Field>
          {target ? (
            <p className="text-base text-pretty" data-testid="merge-summary">
              {mergeSentence(c, target)}
            </p>
          ) : null}
          {error ? <Banner tone="danger" title="Nothing was changed">{error}</Banner> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
