// The accuracy gate shared by the Node run (corpus.test.ts: pasted text and PDFs) and the browser run (e2e/docread/corpus.spec.ts:
// pictures and scans). Every field of every set (dev, held-out, each fresh batch) and every shape has a floor, recorded in a
// committed JSON file; a run below any floor fails, so accuracy can only go up. The owner's bars are reported beside it:
//   dev: items, quantity, unit 100%; every set: every field >= 98%; every shape >= 95%.

import { fieldTable, group, precision, recall, sum, type CaseScore, type Summary } from './score'

export const BARS = { devCore: 1, field: 0.98, shape: 0.95 }

export type Scored = CaseScore & { batch: number; kind: string }

/** The number a floor is kept for: the lower of precision and recall. */
const value = (s: Summary, field: string) => {
  const t = s.fields[field]
  return t ? Math.min(precision(t), recall(t)) : 1
}

export interface GateResult {
  /** Key ("enquiry/b0-dev/items", "enquiry/b0-held/shape:whatsapp") to value, rounded to 0.1%. */
  values: Record<string, number>
  report: string[]
  /** Below the owner's bars (reported, not failing). */
  belowBars: string[]
}

export function setName(batch: number, split: string): string {
  return batch === 0 ? `b0-${split}` : split === 'dev' ? `b${batch}-dev` : `b${batch}-fresh`
}

export function evaluate(scores: Scored[], label: string): GateResult {
  const values: Record<string, number> = {}
  const report: string[] = []
  const belowBars: string[] = []
  const round = (x: number) => Math.floor(x * 1000) / 1000
  for (const kind of ['enquiry', 'quote']) {
    const sets = new Map<string, Scored[]>()
    for (const s of scores.filter(x => x.kind === kind)) {
      const k = setName(s.batch, s.split)
      sets.set(k, [...(sets.get(k) ?? []), s])
    }
    for (const [set, list] of [...sets.entries()].sort()) {
      const all = sum(list)
      report.push(`### ${label}: ${kind} ${set}`, '', fieldTable('all', [['all', all]]), '', fieldTable('shape', group(list, s => s.shape)), '', fieldTable('medium', group(list, s => s.medium)), '')
      for (const f of Object.keys(all.fields)) {
        const v = value(all, f)
        values[`${kind}/${set}/${f}`] = round(v)
        const bar = set.endsWith('-dev') && kind === 'enquiry' && ['items', 'qty', 'unit'].includes(f) ? BARS.devCore : BARS.field
        if (v < bar) belowBars.push(`${kind} ${set} ${f}: ${(100 * v).toFixed(1)}% (bar ${100 * bar}%)`)
      }
      for (const [shape, s] of group(list, x => x.shape)) {
        const v = Math.min(...Object.keys(s.fields).map(f => value(s, f)))
        values[`${kind}/${set}/shape:${shape}`] = round(v)
        if (v < BARS.shape) belowBars.push(`${kind} ${set} ${shape}: ${(100 * v).toFixed(1)}% (bar ${100 * BARS.shape}%)`)
      }
    }
  }
  return { values, report, belowBars }
}

/** Keys whose value fell below the recorded floor. */
export function dropped(values: Record<string, number>, floor: Record<string, number>): string[] {
  return Object.entries(floor)
    .filter(([k, f]) => k in values && (values[k] as number) + 1e-9 < f)
    .map(([k, f]) => `${k}: ${(100 * (values[k] as number)).toFixed(1)}% < floor ${(100 * f).toFixed(1)}%`)
}
