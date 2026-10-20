// Scoring for the enquiry corpora: item precision and recall, and the header facts. Used by enquiryParse.test.ts to compare
// the old intake parser with the new one on the same texts.

export interface ScoredItem {
  description: string
  qty: number
  unit: string | null
}

const LABEL_WORDS = new Set(['make', 'model', 'part', 'no', 'size', 'range', 'output', 'qty', 'nos', 'material'])

export function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => !LABEL_WORDS.has(t)))
}

export function dice(a: string, b: string): number {
  const A = tokens(a)
  const B = tokens(b)
  if (!A.size && !B.size) return 1
  let common = 0
  for (const t of A) if (B.has(t)) common++
  return (2 * common) / (A.size + B.size)
}

/** A predicted row is right when its description is the expected item's (word overlap 0.7 or more) and its quantity is equal. */
export const SAME_ITEM = 0.7

export interface ItemScore {
  expected: number
  predicted: number
  /** Rows that are the expected item with the right quantity. */
  correct: number
  /** Rows that are the expected item, whatever the quantity. */
  found: number
  /** Correct rows whose unit is also right. */
  unitRight: number
}

export function scoreItems(expected: ScoredItem[], predicted: ScoredItem[]): ItemScore {
  const free = predicted.map((_, i) => i)
  let correct = 0
  let found = 0
  let unitRight = 0
  for (const e of expected) {
    let best = -1
    let bestD = 0
    for (const i of free) {
      const d = dice(e.description, (predicted[i] as ScoredItem).description)
      if (d >= SAME_ITEM && (d > bestD || (d === bestD && (predicted[i] as ScoredItem).qty === e.qty))) {
        best = i
        bestD = d
      }
    }
    if (best < 0) continue
    free.splice(free.indexOf(best), 1)
    found++
    const p = predicted[best] as ScoredItem
    if (p.qty === e.qty) {
      correct++
      if (p.unit === e.unit) unitRight++
    }
  }
  return { expected: expected.length, predicted: predicted.length, correct, found, unitRight }
}

export interface FactScore {
  expected: number
  predicted: number
  correct: number
}

export const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

export function scoreFact(expected: string | undefined, predicted: string | null | undefined, acc: FactScore): void {
  if (expected) acc.expected++
  if (predicted) acc.predicted++
  if (expected && predicted && norm(expected) === norm(predicted)) acc.correct++
}

export const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((100 * n) / d)}%`)
