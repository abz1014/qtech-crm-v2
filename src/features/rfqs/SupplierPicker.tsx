import { useId, useMemo, useState } from 'react'
import { Building2, ChevronDown, FileCheck, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DraftItem } from '@/features/rfqs/lib/intakeModel'
import { effectiveQty } from '@/features/rfqs/lib/intakeModel'
import type { SuggestionGroupResult, SupplierSuggestion } from '@/features/rfqs/lib/supplierSuggestion'
import { useCompanyMatches, useSupplierEvidence } from '@/features/rfqs/hooks'
import { Checkbox } from '@/ui/form/Checkbox'
import { Combobox } from '@/ui/form/Combobox'
import { EmptyState } from '@/ui/EmptyState'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { buildMemoryCard, type MemoryRow } from '@/lib/memory'
import { MemoryCardView } from '@/features/rfqs/MemoryCard'
import { PartialNote, ReasonParts } from '@/features/rfqs/ranking/RankParts'
import { evidenceBlock, evidenceFromFeed, evidenceOf } from '@/features/rfqs/lib/ranking/reasons'
import { Icon } from '@/ui/Icon'
import { PICK_BOX, PICK_GROUP, PICK_NOTE, PICK_ROW, SuppliedBeforeChip } from '@/features/rfqs/supplierLook'

/*
 * Suppliers (g2-intake-float frame 4): reasons first. Every suggestion says why in a sentence, with the counts from
 * its history beneath. Only "supplied this item before" is ticked when the step opens. Nothing is scored. Inside a reason
 * group the supplier with the better record comes first (A8). The order behind it (number, the date we placed it, days to
 * delivery) is in the History card (the memory card), so a row is the name, the reason and one record line. The whole row is the tap target.
 */

const pill = 'flex flex-wrap items-center gap-x-2 text-sm text-fg-muted'

export function ItemChips({ items }: { items: readonly DraftItem[] }) {
  return (
    <ul className="m-0 grid list-none p-0">
      {items.map((it, i) => (
        <li key={it.key} title={it.description} className="type-body grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b py-2 text-fg-2 first:border-t">
          <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-selected text-base leading-none text-fg">{i + 1}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{it.description}</span>
          <span className="num shrink-0 text-fg-muted">× {effectiveQty(it)}</span>
        </li>
      ))}
    </ul>
  )
}

/** What the Memory card needs besides the suggestion itself: the rows supplier_item_memory() returned per item, and the items. */
export interface MemoryContext {
  rows: Readonly<Record<string, readonly MemoryRow[] | undefined>>
  items: readonly { id: string; number: number; description: string; brandId?: string | null; familyId?: string | null; brandName?: string | null; familyName?: string | null }[]
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
  const first = useMemo(() => evidenceOf(row), [row])
  // Up to three recent orders (supplier_item_evidence), asked only for a card that is open and has an order behind it.
  const feed = useSupplierEvidence(item ? { description: item.description, brandId: item.brandId ?? null, familyId: item.familyId ?? null } : null, s.supplierId, first !== null)
  const ev = useMemo(() => {
    if (!first) return null
    const more = evidenceFromFeed(feed.data)
    return evidenceBlock(first, { supplier: s.name, brand: item?.brandName, family: item?.familyName }, s.stats, ctx.today, more)
  }, [first, feed.data, item, ctx.today, s])
  if (!item) return null
  const desc = item.description.length > 90 ? `${item.description.slice(0, 89).trimEnd()}…` : item.description
  return (
    <div id={panelId} className="relative z-base mt-2 grid grid-cols-[minmax(0,1fr)] gap-2">
      {covered.length > 1 ? (
        <SegmentedControl
          aria-label={`Item for the history of ${s.name}`}
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
    <li className={cn(PICK_ROW, 'transition-colors duration-fast', ticked && 'bg-selected')} data-row-actions="" data-ticked={ticked || undefined}>
      <Checkbox id={id} checked={ticked} onCheckedChange={v => onToggle(s.supplierId, v === true)} aria-label={s.name} />
      <div className="grid min-w-0 gap-1">
        <label htmlFor={id} className="grid min-w-0 gap-px [overflow-wrap:anywhere] after:absolute after:inset-0 after:cursor-pointer">
          <span className="type-row">{s.name}</span>
          {/* "Karachi · 2 items · same model": how many of the items they are suggested for, and the reason (R2-10; a bare "2 same model" read as a count of models). */}
          <span className={pill}>
            {s.city ? (
              <>
                <span>{s.city}</span>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <span>
              <span className="num">{n}</span> {n === 1 ? 'item' : 'items'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{s.tierLabel}</span>
          </span>
        </label>
        {s.suppliedBefore ? <SuppliedBeforeChip className="mt-1" /> : null}
        <p className="type-body m-0 text-fg-2 [overflow-wrap:anywhere]">{s.reason}</p>
        {/* The order behind the reason lives in Memory (its evidence block), so each supplier takes one line less (R2-10). Without a
            Memory card it stays on the row. */}
        {s.evidence && !memory ? (
          <p className="type-body m-0 flex items-start gap-2 text-fg-2" data-evidence>
            <Icon icon={FileCheck} size="sm" className="mt-1 text-fg-muted" />
            <span className="min-w-0 text-pretty">
              <ReasonParts reason={s.evidence} />
            </span>
          </p>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <p className="m-0 min-w-0 flex-1 basis-[16rem] text-sm text-fg-muted">
            {s.record ? (
              <>
                <span className={cn('text-fg-2', s.record.tone === 'warn' && 'font-semibold text-tone-warning-fg')} data-record>
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
              aria-controls={open ? panelId : undefined}
              aria-label={`History, ${s.name}`}
              onClick={() => setOpen(o => !o)}
              className="relative z-base ml-auto inline-flex h-touch shrink-0 items-center gap-1 rounded-control px-2 text-base font-bold text-primary transition-colors duration-fast hover:bg-surface md:h-control-sm"
            >
              History
              <Icon icon={ChevronDown} size="sm" className={cn('transition-transform duration-base ease-out', open && 'rotate-180')} />
            </button>
          ) : null}
        </div>
        {memory && open ? <MemoryPanel s={s} ctx={memory} panelId={panelId} /> : null}
      </div>
    </li>
  )
}

function Group({ g, ticked, onToggle, memory }: { g: SuggestionGroupResult; ticked: ReadonlySet<string>; onToggle: (id: string, on: boolean) => void; memory?: MemoryContext }) {
  return (
    <section aria-label={g.label} className="border-t first:border-t-0">
      <header className={cn(PICK_GROUP, 'flex flex-wrap items-baseline gap-x-2')}>
        <h3 className="m-0 text-base font-bold">{g.label}</h3>
        <span className="text-sm font-regular text-fg-muted">
          · <span className="num">{g.suppliers.length}</span> {g.suppliers.length === 1 ? 'supplier' : 'suppliers'}
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
  coverage,
  partial,
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
  /** When given, every suggestion gets a History button that opens its memory card. */
  memory?: MemoryContext
  /** "No supplier on file deals in <category> yet." (coverageLine), or null. */
  coverage?: string | null
  /** A read behind the order failed: say so, quietly. */
  partial?: boolean
}) {
  const [text, setText] = useState('')
  // Someone added by hand (or from a supplier's page) who is also suggested shows once, in the reason group, ticked there.
  const shownManual = manual.filter(m => !groups.some(g => g.suppliers.some(s => s.supplierId === m.id)))
  const matches = useCompanyMatches(text)
  const options = (matches.data ?? []).filter(m => !excludeIds.has(m.id) && !manual.some(x => x.id === m.id)).map(m => ({
    value: m.id,
    label: m.name,
    meta: m.country ?? undefined,
  }))

  return (
    <div className="grid gap-4">
      {loading ? (
        <div role="status" className={PICK_BOX} aria-busy="true" aria-label="Finding suppliers">
          <div className="bg-deep px-4 py-2">
            <Skeleton className="h-5 w-1/3" />
          </div>
          {[0, 1].map(n => (
            <div key={n} className={PICK_ROW}>
              <Skeleton className="size-6" />
              <div className="grid gap-2">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <EmptyState
          className="rounded-control border"
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
        <EmptyState className="rounded-control border border-dashed" icon={Building2} title="No supplier on file for these items yet">
          {coverage ?? 'Nothing is suggested until a supplier has dealt in one of these categories, carried one of these brands or supplied something like it.'} Add one by name below, or
          save the RFQ and come back to it.
        </EmptyState>
      ) : null}

      {!loading && ((!error && groups.length > 0) || shownManual.length > 0) ? (
        <div className={PICK_BOX} data-pick>
          {coverage && !error && groups.length > 0 ? (
            <p className={cn(PICK_NOTE, 'type-body m-0')} data-coverage>
              {coverage}
            </p>
          ) : null}
          {partial && !error && groups.length > 0 ? (
            <div className={PICK_NOTE}>
              <PartialNote />
            </div>
          ) : null}
          {error ? null : groups.map(g => <Group key={g.key} g={g} ticked={ticked} onToggle={onToggle} memory={memory} />)}
          {shownManual.length > 0 ? (
            <section aria-label="Added manually" className="border-t first:border-t-0">
              <header className={PICK_GROUP}>
                <h3 className="m-0 text-base font-bold">Added manually</h3>
              </header>
              <ul className="m-0 grid list-none p-0">
                {shownManual.map(m => {
                  const on = ticked.has(m.id)
                  const id = `sup-${m.id}`
                  return (
                    <li key={m.id} data-row-actions="" className={cn(PICK_ROW, 'items-center', on && 'bg-selected')}>
                      <Checkbox id={id} checked={on} onCheckedChange={v => onToggle(m.id, v === true)} aria-label={m.name} />
                      <span className="flex min-w-0 flex-wrap items-center gap-x-3">
                        <label htmlFor={id} className="type-row min-w-0 flex-1 [overflow-wrap:anywhere] after:absolute after:inset-0 after:cursor-pointer">
                          {m.name}
                        </label>
                        <span className="type-body text-fg-muted">Chosen by you</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="grid max-w-md gap-2">
        <label htmlFor="add-supplier" className="type-row">
          Ask a supplier who is not listed
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
          placeholder="Search companies"
        />
        <p className="type-body text-fg-muted">Any company on file can be asked. Add new companies from the Companies screen.</p>
      </div>
    </div>
  )
}
