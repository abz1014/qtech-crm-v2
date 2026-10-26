import { useMemo } from 'react'
import { useCuratedCategories, useSupplierCategoryData } from '@/features/rfqs/hooks'
import type { SupplierHistory, SupplierRecord, SuggestionItem } from '@/features/rfqs/lib/supplierSuggestion'
import type { SuggestLib } from '@/features/rfqs/useSuggestLib'

/**
 * The ranking's category side (C3), for every screen that suggests suppliers: the items with their category filled in (the item's own
 * family, else the dictionary's guess, `categoryGuessed`) and the evidence, price wins and recent asks behind it. Until these load, or if
 * they fail, the list is ranked on the memory alone: nothing waits for them.
 */
export function useSuggestionExtras<T extends SuggestionItem>(items: readonly T[], candidates: readonly SupplierRecord[], today: string, enabledNow: boolean, lib: SuggestLib | null) {
  // Nothing is asked for until the suggestion code has arrived (after the first paint): these reads are not part of the page's first round.
  const enabled = enabledNow && lib !== null
  const categories = useCuratedCategories(enabled)
  const resolved = useMemo(() => (lib ? lib.withCategories(items, categories.data ?? []) : items), [lib, items, categories.data])
  const familyIds = useMemo(() => resolved.flatMap(i => (i.familyId ? [i.familyId] : [])), [resolved])
  const supplierIds = useMemo(() => candidates.map(c => c.id), [candidates])
  const data = useSupplierCategoryData(familyIds, supplierIds, today, enabled && familyIds.length > 0)
  const extra = useMemo<Pick<SupplierHistory, 'categoryEvidence' | 'priceWins' | 'recentAsks'>>(
    () => ({ categoryEvidence: data.data?.evidence, priceWins: data.data?.priceWins, recentAsks: data.data?.recentAsks }),
    [data.data],
  )
  return { items: resolved, extra, categories: categories.data ?? [] }
}
