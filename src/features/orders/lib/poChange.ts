// A8 (O09, shared with O07): has a leg's set of lines changed since its latest PO revision was issued? A PO freezes the lines it listed
// (order line and quantity). A split moves quantity off a line or adds a line to a leg, so the PO no longer matches what the leg holds.
// Prices are not compared: a PO line's price can be typed in the Issue PO dialog and legitimately differ from the order's.

export interface PoLine {
  orderItemId: string
  qty: number
}

export interface LegLine {
  id: string
  description: string
  qty: number
  isService: boolean
}

export interface PoChange {
  /** One short phrase per difference, in line order: "Siemens SITRANS P320 was ×4, now ×3". */
  notes: string[]
}

const EPS = 1e-9

/** Null when the leg still matches its PO (or has no PO). Service lines are never on a PO. */
export function poChange(poLines: readonly PoLine[] | null, legLines: readonly LegLine[]): PoChange | null {
  if (poLines === null) return null
  const now = legLines.filter(l => !l.isService)
  const then = new Map(poLines.map(l => [l.orderItemId, l.qty]))
  const notes: string[] = []
  for (const l of now) {
    const was = then.get(l.id)
    if (was === undefined) notes.push(`${l.description} was added, ×${l.qty}`)
    else if (Math.abs(was - l.qty) > EPS) notes.push(`${l.description} was ×${was}, now ×${l.qty}`)
  }
  const ids = new Set(now.map(l => l.id))
  for (const p of poLines) if (!ids.has(p.orderItemId)) notes.push('A line on the PO is no longer on this leg')
  return notes.length > 0 ? { notes } : null
}
