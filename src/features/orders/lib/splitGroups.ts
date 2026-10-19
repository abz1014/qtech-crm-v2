// A8 (O09): several order lines for one RFQ item are one split item. Grouping is display only: the lines stay separate rows in the
// database (each with its own quantity and leg), so invoices, PO lines and goods state are untouched.
// The numbering reads as the mockup draws it: 1, then 2 with its parts 2a and 2b, then 3.

export interface Groupable {
  id: string
  rfqItemId: string | null
  isService: boolean
  qty: number
  unitPriceNet: number | null
}

export type DisplayRow<T extends Groupable> =
  | { kind: 'row'; key: string; no: string; item: T }
  | { kind: 'head'; key: string; no: string; groupId: string; members: T[]; qty: number; unitPriceNet: number | 'mixed' | null }
  | { kind: 'part'; key: string; no: string; item: T; groupId: string; partIndex: number; partCount: number }

const letter = (i: number) => String.fromCharCode(97 + (i % 26))

export function groupItems<T extends Groupable>(items: readonly T[]): DisplayRow<T>[] {
  const byRfq = new Map<string, T[]>()
  for (const it of items) if (it.rfqItemId && !it.isService) byRfq.set(it.rfqItemId, [...(byRfq.get(it.rfqItemId) ?? []), it])
  const grouped = new Set([...byRfq.entries()].filter(([, m]) => m.length >= 2).map(([k]) => k))

  const out: DisplayRow<T>[] = []
  const done = new Set<string>()
  let no = 0
  for (const it of items) {
    const gid = it.rfqItemId && !it.isService && grouped.has(it.rfqItemId) ? it.rfqItemId : null
    if (!gid) {
      no++
      out.push({ kind: 'row', key: it.id, no: String(no), item: it })
      continue
    }
    if (done.has(gid)) continue
    done.add(gid)
    no++
    const members = byRfq.get(gid) as T[]
    const prices = new Set(members.map(m => m.unitPriceNet))
    const price = prices.size === 1 ? ([...prices][0] ?? null) : 'mixed'
    out.push({ kind: 'head', key: `group:${gid}`, no: String(no), groupId: gid, members, qty: members.reduce((s, m) => s + m.qty, 0), unitPriceNet: price })
    members.forEach((m, i) => out.push({ kind: 'part', key: m.id, no: `${no}${letter(i)}`, item: m, groupId: gid, partIndex: i, partCount: members.length }))
  }
  return out
}
