import { useMemo } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import type { RfqItemRow } from '@/features/rfqs/api'
import { useSupplierCandidates, useSupplierMemory } from '@/features/rfqs/hooks'
import { nextInLine, numbersText } from '@/features/rfqs/escalationLogic'
import { suggestSuppliers } from '@/features/rfqs/lib/supplierSuggestion'

/*
 * The supplier escalation (g2-chase-texts "Chased twice, no reply from X"): float the items this supplier has not priced to
 * someone else? Next in line, by reason, each with its memory line (the same facts the intake suggestions show; memory
 * never scores or reorders). A suggestion only: nothing changes until the person chooses.
 */
export type EscalationItem = RfqItemRow

export function FloatElsewhere({
  supplierName,
  items,
  askedIds,
  today,
  busy,
  onChoose,
  onChaseAgain,
}: {
  supplierName: string
  items: readonly EscalationItem[]
  askedIds: ReadonlySet<string>
  today: string
  busy?: boolean
  /** Ask the suggested suppliers about these items (Float to another supplier). */
  onChoose: (input: { supplierIds: string[]; names: string[]; items: readonly RfqItemRow[] }) => void
  onChaseAgain: () => void
}) {
  const candidates = useSupplierCandidates(true)
  const list = useMemo(() => (candidates.data ?? []).filter(c => !askedIds.has(c.id)), [candidates.data, askedIds])
  const query = useMemo(() => items.map(i => ({ key: i.id, description: i.description, brandId: i.brandId, familyId: i.familyId })), [items])
  const memory = useSupplierMemory(query, list.map(c => c.id), candidates.isSuccess && items.length > 0)
  const result = useMemo(
    () =>
      suggestSuppliers(
        items.map(i => ({ id: i.id, description: i.description, brandId: i.brandId, brandName: i.brandName, familyId: i.familyId, familyName: i.familyName })),
        { suppliers: list, memory: memory.data ?? {} },
        { today },
      ),
    [items, list, memory.data, today],
  )
  const next = nextInLine(result.suppliers, askedIds)
  const numberOf = new Map(items.map(i => [i.id, i.number]))
  const all = numbersText(items.map(i => i.number))
  return (
    <Banner
      tone="warning"
      title={`Chased twice, no reply from ${supplierName}`}
      action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={TriangleAlert} busy={busy} busyLabel="Choosing" disabled={next.length === 0} onClick={() => onChoose({ supplierIds: next.map(s => s.supplierId), names: next.map(s => s.name), items })}>
            Choose suppliers for {all}
          </Button>
          <Button size="sm" onClick={onChaseAgain}>
            Chase again
          </Button>
        </div>
      }
    >
      <span className="block">Ask another supplier for {all}? Next in line, by reason:</span>
      {candidates.isPending || (items.length > 0 && memory.isPending && candidates.isSuccess && list.length > 0) ? (
        <span className="mt-1 block text-fg-muted">Looking at who else carries them…</span>
      ) : next.length === 0 ? (
        <span className="mt-1 block text-fg-muted">Nobody else on file carries {all}. Add a supplier from the RFQ.</span>
      ) : (
        <span role="list" aria-label="Next in line" className="mt-2 grid gap-2">
          {next.map(s => (
            <span role="listitem" key={s.supplierId} className="grid gap-px border-t border-tone-warning-fg/25 pt-2">
              <span className="font-medium">{s.city ? `${s.name} — ${s.city}` : s.name}</span>
              <span>
                {s.reason.replace(/\.$/, '')}
                {s.coversItemIds.length > 0 ? ` (${numbersText(s.coversItemIds.map(id => numberOf.get(id) ?? 0).filter(Boolean))})` : ''}.
              </span>
              <span className="text-xs text-fg-muted">{s.memoryLine}</span>
            </span>
          ))}
        </span>
      )}
    </Banner>
  )
}

