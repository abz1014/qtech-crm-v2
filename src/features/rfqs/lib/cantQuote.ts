// "Can't quote" (Gate 2 decision, 2026-10-14): ONE reason per supplier inquiry, with an optional per-item override.
// Storage uses what the schema already has: supplier_inquiries.no_offer_on (the fact) plus fixed phrases in
// supplier_inquiries.notes (the reason). No new column, no migration.
//
// Notes layout (other lines a person wrote are kept untouched):
//   Can't quote: Doesn't carry this brand
//   Item 2 can't quote: Item discontinued

export const CANT_QUOTE_REASONS = [
  "Doesn't carry this brand",
  "Can't source in time",
  'Item discontinued',
  "Won't quote this quantity",
  'Other reason',
] as const

export type CantQuoteReason = (typeof CANT_QUOTE_REASONS)[number]

export interface CantQuoteNotes {
  /** The reason for the whole inquiry, or null. */
  reason: string | null
  /** Per-item overrides, keyed by the item's 1-based number on the RFQ. */
  items: Record<number, string>
  /** Everything else in the notes, as written. */
  rest: string
}

const WHOLE = /^Can't quote:\s*(.+)$/
const ITEM = /^Item (\d+) can't quote:\s*(.+)$/

export function parseCantQuoteNotes(notes: string | null | undefined): CantQuoteNotes {
  const out: CantQuoteNotes = { reason: null, items: {}, rest: '' }
  const rest: string[] = []
  for (const line of (notes ?? '').split(/\r?\n/)) {
    const t = line.trim()
    const w = WHOLE.exec(t)
    const i = ITEM.exec(t)
    if (w) out.reason = w[1].trim()
    else if (i) out.items[Number(i[1])] = i[2].trim()
    else rest.push(line)
  }
  out.rest = rest.join('\n').trim()
  return out
}

/** The notes text for a parsed value. An empty result is null (the column is nullable). */
export function buildCantQuoteNotes(n: CantQuoteNotes): string | null {
  const lines: string[] = []
  if (n.reason) lines.push(`Can't quote: ${n.reason}`)
  for (const k of Object.keys(n.items).map(Number).sort((a, b) => a - b)) {
    if (n.items[k]) lines.push(`Item ${k} can't quote: ${n.items[k]}`)
  }
  if (n.rest) lines.push(n.rest)
  return lines.length ? lines.join('\n') : null
}

/** Notes after the whole inquiry is marked "can't quote" for `reason` (earlier per-item overrides are kept). */
export function withReason(notes: string | null | undefined, reason: string): string | null {
  return buildCantQuoteNotes({ ...parseCantQuoteNotes(notes), reason })
}

/** Notes after the whole-inquiry reason is taken back (Undo). */
export function withoutReason(notes: string | null | undefined): string | null {
  return buildCantQuoteNotes({ ...parseCantQuoteNotes(notes), reason: null })
}

/** Notes with one item's override set (a reason) or cleared (null). */
export function withItemReason(notes: string | null | undefined, itemNumber: number, reason: string | null): string | null {
  const p = parseCantQuoteNotes(notes)
  const items = { ...p.items }
  if (reason) items[itemNumber] = reason
  else delete items[itemNumber]
  return buildCantQuoteNotes({ ...p, items })
}

/** The reason that applies to an item: its own override, else the inquiry's. */
export function reasonForItem(n: CantQuoteNotes, itemNumber: number): string | null {
  return n.items[itemNumber] ?? n.reason
}
