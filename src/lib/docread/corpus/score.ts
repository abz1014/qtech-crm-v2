// Scores what the reader made of a corpus case against its truth, field by field, and sums the scores per field, per shape and
// per medium. An item is found when its description matches (letters and digits, case ignored, label words like "Make" and
// "Part No" ignored, Dice overlap of the words >= 0.9); then quantity (exact), unit (the customer's unit, "Nos" = "No." = "nos")
// and part number (exactly as written, inside the description) are checked on it.

import type { CorpusCase, EnquiryCase, QuoteCase } from './model'
import { unitFamily } from './units'

const LABEL_WORDS = new Set(['make', 'model', 'part', 'no', 'brand', 'size', 'qty', 'p', 'n', 'pn', 'code', 'material'])

/**
 * The words of a description, normalised: lower case, split at anything that is not a letter or a digit and where letters
 * meet digits ("PLC,CPU;24VDC" and "PLC.CPU24VDC" are the same words: plc cpu 24 vdc), label words left out.
 */
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z]+|[0-9]+/g) ?? []).filter(t => !LABEL_WORDS.has(t))
}

export function dice(a: string, b: string): number {
  const A = tokens(a)
  const B = tokens(b)
  if (!A.length && !B.length) return 1
  const left = [...B]
  let common = 0
  for (const t of A) {
    const i = left.indexOf(t)
    if (i >= 0) {
      common++
      left.splice(i, 1)
    }
  }
  return (2 * common) / (A.length + B.length)
}

export const SAME_ITEM = 0.9

export const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

export interface Tally {
  /** Correct answers. */
  tp: number
  /** Answers given that are wrong or not wanted. */
  fp: number
  /** Wanted answers missed or wrong. */
  fn: number
}

const tally = (): Tally => ({ tp: 0, fp: 0, fn: 0 })

export type Fields = Record<string, Tally>

export interface CaseScore {
  id: string
  shape: string
  medium: string
  split: string
  fields: Fields
  /** Everything right. */
  perfect: boolean
  problems: string[]
}

export interface EnquiryResult {
  items: Array<{ description: string; qty: number; unit: string | null }>
  ref: string | null
  due: string | null
  company: string | null
  domain: string | null
}

function fact(f: Fields, name: string, want: string | undefined, got: string | null, same: (a: string, b: string) => boolean, problems: string[]): void {
  const t = (f[name] ??= tally())
  if (want && got && same(want, got)) t.tp++
  else {
    if (want) t.fn++
    if (got && (want || name === 'due')) t.fp++
    if (want || (got && name === 'due')) problems.push(`${name}: want ${want ?? '-'} got ${got ?? '-'}`)
  }
}

export function scoreEnquiry(c: EnquiryCase, got: EnquiryResult): CaseScore {
  const f: Fields = { items: tally(), description: tally(), qty: tally(), unit: tally(), part: tally(), count: tally() }
  const problems: string[] = []
  const free = got.items.map((_, i) => i)
  for (const want of c.truth.items) {
    let best = -1
    let bestD = 0
    for (const i of free) {
      const g = got.items[i] as EnquiryResult['items'][number]
      const d = dice(want.description, g.description)
      if (d >= SAME_ITEM && (d > bestD || (d === bestD && g.qty === want.qty))) {
        best = i
        bestD = d
      }
    }
    if (best < 0) {
      f.items!.fn++
      f.description!.fn++
      f.qty!.fn++
      f.unit!.fn++
      if (want.part) f.part!.fn++
      const near = got.items.map(g => ({ g, d: dice(want.description, g.description) })).sort((a, b) => b.d - a.d)[0]
      problems.push(`missed: ${want.description} | ${want.qty} ${want.unit ?? ''}${near ? `  (nearest ${near.d.toFixed(2)}: ${near.g.description} | ${near.g.qty} ${near.g.unit ?? ''})` : ''}`)
      continue
    }
    free.splice(free.indexOf(best), 1)
    const g = got.items[best] as EnquiryResult['items'][number]
    f.items!.tp++
    f.description!.tp++
    if (g.qty === want.qty) f.qty!.tp++
    else {
      f.qty!.fn++
      f.qty!.fp++
      problems.push(`qty: ${want.description}: want ${want.qty} got ${g.qty}`)
    }
    if (unitFamily(g.unit) === unitFamily(want.unit)) f.unit!.tp++
    else {
      f.unit!.fn++
      f.unit!.fp++
      problems.push(`unit: ${want.description}: want ${want.unit ?? '-'} got ${g.unit ?? '-'}`)
    }
    if (want.part) {
      if (g.description.replace(/\s+/g, '').includes(want.part.replace(/\s+/g, ''))) f.part!.tp++
      else {
        f.part!.fn++
        f.part!.fp++
        problems.push(`part: want ${want.part} in "${g.description}"`)
      }
    }
  }
  for (const i of free) {
    f.items!.fp++
    f.description!.fp++
    problems.push(`extra: ${(got.items[i] as EnquiryResult['items'][number]).description} | ${(got.items[i] as EnquiryResult['items'][number]).qty}`)
  }
  if (got.items.length === c.truth.items.length) f.count!.tp++
  else {
    f.count!.fn++
    f.count!.fp++
  }
  fact(f, 'ref', c.truth.ref, got.ref, (a, b) => norm(a) === norm(b), problems)
  fact(f, 'due', c.truth.due, got.due, (a, b) => a === b, problems)
  fact(f, 'company', c.truth.company, got.company, (a, b) => norm(a) === norm(b), problems)
  fact(f, 'domain', c.truth.domain, got.domain, (a, b) => a.toLowerCase() === b.toLowerCase(), problems)
  return { id: c.id, shape: c.shape, medium: c.medium, split: c.split, fields: f, perfect: problems.length === 0, problems }
}

export interface QuoteResult {
  offers: Array<{ itemId: string | null; unitPrice: number | null; currency: string | null; leadMax: number | null; validityDays: number | null }>
  currency: string | null
  validityDays: number | null
  leadMax: number | null
  payment: string | null
  incoterm: string | null
  quoteRef: string | null
}

export function scoreQuote(c: QuoteCase, got: QuoteResult): CaseScore {
  const f: Fields = { offers: tally(), price: tally(), currency: tally(), lead: tally(), validity: tally() }
  const problems: string[] = []
  const used = new Set<number>()
  for (const want of c.truth.lines) {
    const i = got.offers.findIndex((o, k) => !used.has(k) && o.itemId === want.itemId && o.unitPrice !== null)
    if (i < 0) {
      for (const k of ['offers', 'price', 'currency', 'lead', 'validity']) f[k]!.fn++
      problems.push(`missed offer ${want.itemId} ${want.unitPrice} ${want.currency}`)
      continue
    }
    used.add(i)
    const o = got.offers[i] as QuoteResult['offers'][number]
    f.offers!.tp++
    const check = (k: string, ok: boolean, msg: string) => {
      if (ok) f[k]!.tp++
      else {
        f[k]!.fn++
        f[k]!.fp++
        problems.push(`${k} ${want.itemId}: ${msg}`)
      }
    }
    check('price', Math.abs((o.unitPrice as number) - want.unitPrice) < 0.005, `want ${want.unitPrice} got ${o.unitPrice}`)
    check('currency', (o.currency ?? got.currency) === want.currency, `want ${want.currency} got ${o.currency ?? got.currency}`)
    if (want.leadMax !== undefined) check('lead', (o.leadMax ?? got.leadMax) === want.leadMax, `want ${want.leadMax} got ${o.leadMax ?? got.leadMax}`)
    if (want.validityDays !== undefined) check('validity', (o.validityDays ?? got.validityDays) === want.validityDays, `want ${want.validityDays} got ${o.validityDays ?? got.validityDays}`)
  }
  got.offers.forEach((o, k) => {
    if (used.has(k) || o.unitPrice === null) return
    f.offers!.fp++
    problems.push(`extra offer ${o.itemId ?? 'unmatched'} ${o.unitPrice}`)
  })
  const qf = (name: string, want: string | undefined, have: string | null, same: (a: string, b: string) => boolean) => {
    const t = (f[name] ??= tally())
    if (!want) return
    if (have && same(want, have)) t.tp++
    else {
      t.fn++
      if (have) t.fp++
      problems.push(`${name}: want ${want} got ${have ?? '-'}`)
    }
  }
  qf('payment', c.truth.payment, got.payment, (a, b) => norm(b).includes(norm(a)))
  qf('incoterm', c.truth.incoterm, got.incoterm, (a, b) => norm(a) === norm(b))
  qf('quoteRef', c.truth.quoteRef, got.quoteRef, (a, b) => norm(a) === norm(b))
  return { id: c.id, shape: c.shape, medium: c.medium, split: c.split, fields: f, perfect: problems.length === 0, problems }
}

// ------------------------------------------------------------------------------------------------ sums and the report

export interface Summary {
  cases: number
  perfect: number
  fields: Fields
}

export function sum(scores: CaseScore[]): Summary {
  const fields: Fields = {}
  for (const s of scores) {
    for (const [k, t] of Object.entries(s.fields)) {
      const a = (fields[k] ??= tally())
      a.tp += t.tp
      a.fp += t.fp
      a.fn += t.fn
    }
  }
  return { cases: scores.length, perfect: scores.filter(s => s.perfect).length, fields }
}

export const precision = (t: Tally) => (t.tp + t.fp === 0 ? 1 : t.tp / (t.tp + t.fp))
export const recall = (t: Tally) => (t.tp + t.fn === 0 ? 1 : t.tp / (t.tp + t.fn))
const pc = (x: number) => `${(100 * x).toFixed(1)}%`

/** The lowest of precision and recall over the given fields: the number every gate compares. */
export function worst(s: Summary, fields?: string[]): { field: string; value: number } {
  let out = { field: '-', value: 1 }
  for (const [k, t] of Object.entries(s.fields)) {
    if (fields && !fields.includes(k)) continue
    const v = Math.min(precision(t), recall(t))
    if (v < out.value) out = { field: k, value: v }
  }
  return out
}

export function fieldTable(title: string, groups: Array<[string, Summary]>): string {
  const names = [...new Set(groups.flatMap(([, s]) => Object.keys(s.fields)))]
  const head = `| ${title} | cases | perfect | ${names.join(' | ')} |`
  const rows = groups.map(([g, s]) => `| ${g} | ${s.cases} | ${s.perfect} | ${names.map(n => (s.fields[n] && s.fields[n].tp + s.fields[n].fn + s.fields[n].fp > 0 ? `${pc(precision(s.fields[n]))} / ${pc(recall(s.fields[n]))}` : '-')).join(' | ')} |`)
  return [head, `|${'---|'.repeat(names.length + 3)}`, ...rows].join('\n')
}

export function group(scores: CaseScore[], key: (s: CaseScore) => string): Array<[string, Summary]> {
  const m = new Map<string, CaseScore[]>()
  for (const s of scores) m.set(key(s), [...(m.get(key(s)) ?? []), s])
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, sum(v)])
}

export type { CorpusCase }
