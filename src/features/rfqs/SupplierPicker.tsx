import { useId, useMemo, useState } from 'react'
import { Building2, ChevronDown, FileCheck, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DraftItem } from '@/features/rfqs/lib/intakeModel'
import { effectiveQty } from '@/features/rfqs/lib/intakeModel'
import type { SuggestionGroupResult, SupplierSuggestion } from '@/features/rfqs/lib/supplierSuggestion'
import { useCompanyMatches } from '@/features/rfqs/hooks'
import { Checkbox } from '@/ui/form/Checkbox'
import { Combobox } from '@/ui/form/Combobox'
import { EmptyState } from '@/ui/EmptyState'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { buildMemoryCard, type MemoryRow } from '@/lib/memory'
import { MemoryCardView } from '@/features/rfqs/MemoryCard'
import { ReasonParts } from '@/features/rfqs/ranking/RankParts'
import { evidenceBlock, evidenceOf } from '@/features/rfqs/lib/ranking/reasons'
import { Icon } from '@/ui/Icon'

/*
 * Suppliers (g2-intake-float frame 4): reasons first. Every suggestion says why in a sentence, with the counts from
 * its history beneath. Only "supplied this item before" is ticked when the step opens. Nothing is scored. Inside a reason
 * group the supplier with the better record comes first (A8), and the order behind it is cited: number, the date we placed it,
 * days to delivery. The whole row is the tap target.
 */

const pill = 'inline-flex h-5 shrink-0 items-center gap-[6px] whitespace-nowrap rounded border border-line-strong bg-surface px-[6px] text-xs text-fg-2'

export function ItemChips({ items }: { items: readonly DraftItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {items.map((it, i) => (
        <li key={it.key} title={it.description} className="inline-flex h-6 max-w-full items-center gap-2 rounded border bg-surface px-2 text-xs text-fg-2">
          <span className="num text-fg-muted">{i + 1}</span>
          <span className="truncate">{it.description}</span>
          <span className="num shrink-0 text-fg-muted">× {effectiveQty(it)}</span>
        </li>
      ))}
    </ul>
  )
}

/** What the Memory card needs besides the suggestion itself: the rows supplier_item_memory() returned per item, and the items. */
export interface MemoryContext {
  rows: Readonly<Record<string, readonly MemoryRow[] | undefined>>
  items: readonly { id: string; number: number; description: string; brandName?: string | null; familyName?: string | null }[]
  today: string
}

function MemoryPanel({ s, ctx, panelId }: { s: SupplierSuggestion; ctx: MemoryContext; panelId: string }) {
  // The items this supplier was suggested for, strongest history first (then item order).
  const covered = useMemo(() => {
    const list = ctx.items.filter(i => s.coversItemIds.includes(i.id))
    const tierOf = (id: string) => ctx.rows[id]?.find(r => r.supplier_id === s.supplierId)?.best_tier ?? 9
    return [...list].sort((a, b) => tierOf(a.id) - tierOf(b.id) || a.number - b.number)
  }, [ctx, s])
  const [picked, setPicked] = useState<string | null>(null)
  const item = covered.find(i => i.id === picked) ?? covered[0]
  const row = item ? ctx.rows[item.id]?.find(r => r.supplier_id === s.supplierId) : undefined
  const card = useMemo(() => buildMemoryCard(row, s.stats, ctx.today), [row, s.stats, ctx.today])
  const ev = useMemo(() => {
    const e = evidenceOf(row)
    return e ? evidenceBlock(e, { supplier: s.name, brand: item?.brandName, family: item?.familyName }, s.stats, ctx.today) : null
  }, [row, item, ctx.today, s])
  if (!item) return null
  const desc = item.description.length > 90 ? `${item.description.slice(0, 89).trimEnd()}…` : item.description
  return (
    <div id={panelId} className="relative z-10 mt-2 grid gap-2 pl-[30px] pr-0">
      {covered.length > 1 ? (
        <SegmentedControl
          aria-label={`Item for the memory of ${s.name}`}
          value={item.id}
          onValueChange={setPicked}
          options={covered.map(i => ({ value: i.id, label: `Item ${i.number}` }))}
        />
      ) : null}
      <MemoryCardView
        supplierName={s.name}
        itemLine={`For item ${item.number}, ${desc}.`}
        card={card}
        today={ctx.today}
        fallbackTier={s.tierLabel}
        evidence={ev}
      />
    </div>
  )
}

function SupplierRow({ s, ticked, onToggle, memory }: { s: SupplierSuggestion; ticked: boolean; onToggle: (id: string, on: boolean) => void; memory?: MemoryContext }) {
  const id = `sup-${s.supplierId}`
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const n = s.coversItemIds.length
  return (
    <li className={cn('relative grid gap-1 border-t px-5 py-3 first:border-t-0', ticked && 'bg-selected')} data-ticked={ticked || undefined}>
      <div className="flex min-w-0 items-center gap-3">
        <Checkbox id={id} checked={ticked} onCheckedChange={v => onToggle(s.supplierId, v === true)} aria-label={s.name} />
        <label htmlFor={id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm font-medium after:absolute after:inset-0 after:cursor-pointer">
          <span className="min-w-0">{s.name}</span>
          {s.city ? <span className="text-xs font-regular text-fg-muted">{s.city}</span> : null}
        </label>
        <span className={cn(pill, 'ml-auto')}>
          <span className="num">{n}</span>
          {s.tierLabel}
        </span>
      </div>
      <p className="m-0 pl-[30px] text-sm text-fg-2">{s.reason}</p>
      {s.evidence ? (
        <p className="m-0 flex items-start gap-[6px] pl-[30px] text-xs text-fg-2" data-evidence>
          <Icon icon={FileCheck} size="chip" className="mt-[2px] text-fg-muted" />
          <span className="text-pretty">
            <ReasonParts reason={s.evidence} />
          </span>
        </p>
      ) : null}
      <div className="flex min-w-0 items-center gap-3 pl-[30px]">
        <p className={cn('m-0 min-w-0 flex-1 text-xs text-fg-muted',)}>
          {s.record ? (
            <>
              <span className={cn('text-fg-2', s.record.tone === 'warn' && 'font-medium text-tone-warning-fg')} data-record>
                <ReasonParts reason={s.record} />
              </span>
              {' · '}
            </>
          ) : null}
          <span data-memory-line>{s.memoryLine}</span>
        </p>
        {memory ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`Memory, ${s.name}`}
            onClick={() => setOpen(o => !o)}
            className="relative z-10 inline-flex h-6 shrink-0 items-center gap-1 rounded px-2 text-xs font-medium text-fg-2 hover:bg-selected"
          >
            Memory
            <ChevronDown aria-hidden="true" size={14} strokeWidth={1.75} className={cn('transition-transform', open && 'rotate-180')} />
          </button>
        ) : null}
      </div>
      {memory && open ? <MemoryPanel s={s} ctx={memory} panelId={panelId} /> : null}
    </li>
  )
}

function Group({ g, ticked, onToggle, memory }: { g: SuggestionGroupResult; ticked: ReadonlySet<string>; onToggle: (id: string, on: boolean) => void; memory?: MemoryContext }) {
  return (
    <section aria-label={g.label} className="overflow-hidden rounded border bg-surface">
      <header className="flex items-baseline gap-3 border-b bg-sunken px-5 py-3">
        <h3 className="m-0 text-sm font-semibold">{g.label}</h3>
        <span className="ml-auto text-xs text-fg-muted">
          <span className="num">{g.suppliers.length}</span> {g.suppliers.length === 1 ? 'supplier' : `suppliers · best record first`}
        </span>
      </header>
      <ul className="m-0 grid list-none p-0">
        {g.suppliers.map(s => (
          <SupplierRow key={s.supplierId} s={s} ticked={ticked.has(s.supplierId)} onToggle={onToggle} memory={memory} />
        ))}
      </ul>
    </section>
  )
}

export interface ManualSupplier {
  id: string
  name: string
}

export function SupplierPicker({
  groups,
  ticked,
  onToggle,
  manual,
  onAddManual,
  excludeIds,
  loading,
  error,
  onRetry,
  memory,
}: {
  groups: readonly SuggestionGroupResult[]
  ticked: ReadonlySet<string>
  onToggle: (id: string, on: boolean) => void
  manual: readonly ManualSupplier[]
  onAddManual: (s: ManualSupplier) => void
  /** Never offered in the "not listed" search: the customer itself and anyone already shown. */
  excludeIds: ReadonlySet<string>
  loading: boolean
  error: boolean
  onRetry: () => void
  /** When given, every suggestion gets a Memory button that opens its card. */
  memory?: MemoryContext
}) {
  const [text, setText] = useState('')
  const matches = useCompanyMatches(text)
  const options = (matches.data ?? []).filter(m => !excludeIds.has(m.id) && !manual.some(x => x.id === m.id)).map(m => ({
    value: m.id,
    label: m.name,
    meta: m.country ?? undefined,
  }))

  return (
    <div className="grid gap-4">
      {loading ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Finding suppliers">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <EmptyState
          className="rounded border bg-surface"
          mood="error"
          icon={Search}
          title="Suggestions did not load"
          actions={
            <Button onClick={onRetry}>Try again</Button>
          }
        >
          You can still add a supplier by name below, or save the RFQ and float it later.
        </EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState className="rounded border bg-surface" icon={Building2} title="No supplier on file for these items yet">
          Nothing is suggested until a supplier has carried one of these brands or supplied something like it. Add one by name below, or
          save the RFQ and come back to it.
        </EmptyState>
      ) : (
        groups.map(g => <Group key={g.group} g={g} ticked={ticked} onToggle={onToggle} memory={memory} />)
      )}

      {manual.length > 0 ? (
        <section aria-label="Added by you" className="overflow-hidden rounded border bg-surface">
          <header className="flex items-baseline gap-3 border-b bg-sunken px-5 py-3">
            <h3 className="m-0 text-sm font-semibold">Added by you</h3>
          </header>
          <ul className="m-0 grid list-none p-0">
            {manual.map(m => {
              const on = ticked.has(m.id)
              const id = `sup-${m.id}`
              return (
                <li key={m.id} className={cn('relative flex items-center gap-3 border-t px-5 py-3 first:border-t-0', on && 'bg-selected')}>
                  <Checkbox id={id} checked={on} onCheckedChange={v => onToggle(m.id, v === true)} aria-label={m.name} />
                  <label htmlFor={id} className="text-sm font-medium after:absolute after:inset-0 after:cursor-pointer">
                    {m.name}
                  </label>
                  <span className="ml-auto text-xs text-fg-muted">Chosen by you</span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid max-w-[420px] gap-[6px]">
        <label htmlFor="add-supplier" className="text-sm font-medium">
          Ask someone who is not listed
        </label>
        <Combobox
          id="add-supplier"
          options={options}
          value=""
          onChange={v => {
            const hit = (matches.data ?? []).find(m => m.id === v)
            if (hit) {
              onAddManual({ id: hit.id, name: hit.name })
              setText('')
            }
          }}
          onQueryChange={setText}
          loading={matches.isFetching}
          placeholder="Search a company by name"
        />
        <p className="text-xs text-fg-muted">Any company on file can be asked. Add new companies from the Companies screen.</p>
      </div>
    </div>
  )
}
