/*
 * BUG-SALES-3: the same message pasted twice (the first Ctrl+V seemed not to land) must not double the items. A pasted line that is
 * exactly an item already in the list (same description, quantity and unit, ignoring case and spacing) is skipped and counted, so
 * the screen can say "2 lines were already there".
 */
interface ItemLike {
  description: string
  qty: number | null
  unit: string | null
}

const keyOf = (i: ItemLike) => `${i.description.trim().replace(/\s+/g, ' ').toLowerCase()}|${i.qty ?? ''}|${(i.unit ?? '').trim().toLowerCase()}`

export function skipRepeats<T extends ItemLike>(existing: readonly ItemLike[], parsed: readonly T[]): { fresh: T[]; repeated: number } {
  const seen = new Set(existing.map(keyOf))
  const fresh = parsed.filter(p => !seen.has(keyOf(p)))
  return { fresh, repeated: parsed.length - fresh.length }
}

export const repeatedNote = (n: number): string => `${n} ${n === 1 ? 'line was' : 'lines were'} already there`
