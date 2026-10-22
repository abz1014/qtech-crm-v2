// The reader's corpus: fictional enquiries and supplier quotes in every shape and medium, made from a seed. Batch 0 is split
// 70% dev / 30% held-out (by a hash of the case id, so adding cases never moves old ones); later batches are fresh: new seeds
// and template sets written after the reader was tuned, checked once, first try, then added to dev.

import { ENQUIRY_TEMPLATES, QUOTE_TEMPLATES } from './templates'
import type { CorpusCase, EnquiryCase, Medium, QuoteCase, Shot, TextStyle } from './model'
import { hash, rng, type Rng } from './rng'

export const CORPUS_TODAY = '2026-10-20'

const FONTS = {
  calibri: 'Carlito, Calibri, "Segoe UI", Arial, sans-serif',
  arial: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  tahoma: 'Tahoma, Verdana, "DejaVu Sans", sans-serif',
  segoe: '"Segoe UI", Roboto, Arial, sans-serif',
  times: '"Times New Roman", "Liberation Serif", Times, serif',
  roboto: 'Roboto, Arial, Helvetica, sans-serif',
}

function textStyle(r: Rng, hasHead: boolean): TextStyle {
  const table = r.pick(hasHead ? (['tab', 'tab', 'tab', 'spaces', 'pipes', 'cells'] as const) : (['tab', 'tab', 'tab', 'tab', 'spaces'] as const))
  return { table, chat: r.pick(['android', 'ios', 'web'] as const) }
}

function shotFor(r: Rng, c: { doc: CorpusCase['doc']; medium: Medium }): Shot {
  const look = c.doc.look
  if (c.medium === 'scan') {
    return { ui: 'paper', width: 900, scale: r.pick([1.25, 1.5]), font: r.pick([FONTS.arial, FONTS.times, FONTS.calibri]), format: 'jpeg', quality: r.int(60, 85), tilt: r.pick([0, 0.5, -0.8, 1.2, -1.5, 2]), contrast: r.pick([1, 0.9, 0.8]), blur: r.pick([0, 0, 0.4]) }
  }
  if (look === 'chat') {
    return { ui: 'whatsapp', width: 393, scale: r.pick([2, 2.75, 3]), font: r.pick([FONTS.roboto, FONTS.segoe, FONTS.arial]), dark: r.chance(0.35), format: r.pick(['png', 'jpeg', 'png']), quality: 80, phone: true }
  }
  if (look === 'paper' || (look === 'sheet' && r.chance(0.5))) {
    // A phone photo of a printed page.
    const photo = r.chance(0.7)
    return {
      ui: 'paper',
      width: 900,
      scale: r.pick([1, 1.25, 1.5]),
      font: r.pick([FONTS.arial, FONTS.times, FONTS.calibri, FONTS.tahoma]),
      format: 'jpeg',
      quality: r.int(55, 85),
      tilt: photo ? r.pick([3, -3, 4, -5, 6, -6, 8, -8]) : 0,
      blur: photo ? r.pick([0, 0.5, 0.8, 1]) : 0,
      shadow: photo && r.chance(0.6),
      contrast: photo ? r.pick([1, 0.85, 0.7, 0.6]) : 1,
      photo,
    }
  }
  if (look === 'sheet') return { ui: 'excel', width: 1100, scale: r.pick([1, 1.25, 1.5]), font: r.pick([FONTS.calibri, FONTS.arial]), format: r.pick(['png', 'jpeg']), quality: 85 }
  const phone = r.chance(0.25)
  const photo = !phone && r.chance(0.15)
  return {
    ui: r.pick(['outlook', 'outlook', 'gmail']),
    width: phone ? 393 : r.pick([1024, 1280, 1366]),
    scale: phone ? r.pick([2, 2.75]) : r.pick([1, 1, 1.25, 1.5]),
    font: r.pick([FONTS.calibri, FONTS.arial, FONTS.tahoma, FONTS.segoe]),
    dark: !photo && r.chance(0.2),
    format: photo ? 'jpeg' : r.pick(['png', 'png', 'jpeg', 'webp']),
    quality: photo ? 70 : 85,
    phone,
    photo,
    tilt: photo ? r.pick([3, -4, 5]) : 0,
    blur: photo ? 0.6 : 0,
    contrast: photo ? 0.8 : 1,
  }
}

/** The medium mix: most enquiries are pasted text, then PDFs, then pictures. */
const MEDIUM_WEIGHT: Record<Medium, number> = { text: 0.42, pdf: 0.26, image: 0.22, scan: 0.1 }

function pickMedium(r: Rng, media: Medium[]): Medium {
  const total = media.reduce((n, m) => n + MEDIUM_WEIGHT[m], 0)
  let x = r.next() * total
  for (const m of media) {
    x -= MEDIUM_WEIGHT[m]
    if (x <= 0) return m
  }
  return media[0] as Medium
}

function weighted<T extends { weight: number }>(r: Rng, xs: readonly T[]): T {
  const total = xs.reduce((n, x) => n + x.weight, 0)
  let x = r.next() * total
  for (const t of xs) {
    x -= t.weight
    if (x <= 0) return t
  }
  return xs[0] as T
}

export interface BatchSpec {
  batch: number
  enquiries: number
  quotes: number
  /** Template generations used (0: the first set). */
  gens: number[]
  /** All of it is for development (more of the same generator, other seeds), none held out. */
  dev?: boolean
  /** Run in CI against its floors (a fresh batch joins once it has been checked first-try). */
  gate?: boolean
}

/**
 * Batch 0 is dev + held-out (70/30). Batches 10 and 11 are extra dev data from the same templates. Batches 1, 2, ... are fresh:
 * new seeds and template generations written after the reader passed what came before; each is checked once, first try.
 */
export const BATCHES: BatchSpec[] = [
  { batch: 0, enquiries: 180, quotes: 72, gens: [0], gate: true },
  { batch: 10, enquiries: 120, quotes: 48, gens: [0], dev: true, gate: true },
  { batch: 11, enquiries: 120, quotes: 48, gens: [0], dev: true, gate: true },
  // Fresh batch 1, first try (text and PDF): enquiry items 97.6% / 96.5%, quotes 100% / 99.5%: below 98%, so it became dev data.
  { batch: 1, enquiries: 120, quotes: 48, gens: [0, 1], dev: true, gate: true },
  // Fresh batch 2, first try (text and PDF): enquiry items 97.6% / 83.7% (sideways pages, SMS-style lines), quotes 88.1% / 97.5%: dev now.
  { batch: 2, enquiries: 120, quotes: 48, gens: [0, 1, 2], dev: true, gate: true },
  // Fresh batch 3, first try (text and PDF): enquiry items 98.5% / 96.0% (items in one sentence), company 66.7%; quotes 98.6% / 100%,
  // lead time 84.7% (a Wks column): dev now.
  { batch: 3, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3], dev: true, gate: true },
  // Fresh batch 4, first try (text and PDF): enquiry items 95.6% / 99.3% (Teams name-and-time lines), quotes 100%: dev now.
  { batch: 4, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4], dev: true, gate: true },
  // Fresh batch 5, first try (text and PDF): enquiry items 98.5% / 98.5%, every field >= 98%, quotes 100%, but one shape below 95%
  // (items in square brackets, 87%): dev now.
  { batch: 5, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5], dev: true, gate: true },
  // Fresh batch 6, first try (text and PDF): every field and shape 100%. Kept held out, run in CI.
  { batch: 6, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6], gate: true },
  // Fresh batch 7, first try (text and PDF): every field >= 98% (items 99.5%), quotes 100%, but one shape 94.4% (a WhatsApp list
  // with dashes): dev now.
  { batch: 7, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7], dev: true, gate: true },
  // Fresh batch 8, first try (text and PDF): enquiry items 95.2% / 100% (a forwarded WhatsApp list in *bold*), quotes 100%: dev now.
  { batch: 8, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8], dev: true, gate: true },
  // Fresh batch 9, first try (text and PDF): enquiry items 98.6% / 98.6%, due 95.5%, count 97.8%; quotes 100%: dev now.
  { batch: 9, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], dev: true, gate: true },
  // Fresh batch 12, first try (text and PDF): enquiry items 99.4% / 99.0%, count 97.9%, due 100% / 95.8%; quotes offers 80.0% / 97.8%,
  // price 87.9% / 85.9% (list price, discount and net price columns): dev now.
  { batch: 12, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dev: true, gate: true },
  // Fresh batch 13, first try (text and PDF): enquiry items 99.0% / 99.5%, count 97.8% (section rows inside a table), quotes 100%:
  // dev now.
  { batch: 13, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], dev: true, gate: true },
  // Fresh batch 14, first try (text and PDF): enquiry items 95.1% / 92.8%, count 87.7%, company 93.4% (portal lines with labels,
  // quantities in square brackets, an estimate form copied one cell per line); quotes offers 100% / 98.6%, currency 90.5%: dev now.
  { batch: 14, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], dev: true, gate: true },
  // Fresh batch 15, first try (text and PDF): enquiry items 99.8% / 99.8%, every enquiry field >= 99.8%; quotes 100% / 99.2% (after
  // correcting the template's incoterm truth to "FOB Shenzhen"), but two shapes below 95% on one case each ("1NO" read as a
  // quantity; an offer missed in an order-code table): dev now.
  { batch: 15, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], dev: true, gate: true },
  // Fresh batch 16, first try (text and PDF): enquiry items 99.3% / 99.6%, count 98.8%, quotes 100%, but one shape at 0% (an item
  // code column before the item name, one case): dev now.
  { batch: 16, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], dev: true, gate: true },
  // Fresh batch 17, first try (text and PDF): enquiry items 95.3% / 97.6%, count 85.1% (the item only in the subject line, a
  // document title over an ERP table, "Also add: 2 sets ..., 1 each ..."), quotes 100%: dev now.
  { batch: 17, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], dev: true, gate: true },
  // Fresh batch 18, first try (text and PDF): enquiry items 98.1% / 98.1%, qty 96.6% / 94.8%, unit 95.5% / 93.7% ("Brand: X / Qty: 4
  // Pcs" under each item); quotes offers 90.0% / 97.4% (a VAT-excluded price heading): dev now.
  { batch: 18, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], dev: true, gate: true },
  // Fresh batch 19, first try (text and PDF): enquiry items 99.6% / 99.8%, qty 96.8% / 96.6% ("- Qty: 3 Nos" as a sub-bullet),
  // count 98.9%; quotes offers 99.5% (two items sharing "SS316"): dev now.
  { batch: 19, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], dev: true, gate: true },
  // Fresh batch 20, first try (text and PDF): enquiries 100% on every field and shape; quotes offers 100% / 97.6%, price 94.6% /
  // 92.4% (German column headings Menge / Einzelpreis / Gesamtpreis): dev now.
  { batch: 20, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], dev: true, gate: true },
  // Fresh batch 21, first try (text and PDF): enquiry items 98.5% precision / 95.1% recall, count 94.6% (an "external email"
  // caution banner read as the disclaimer, "Nos 10" with the unit first, "(1) 02 Nos - ..."); quotes 100%: dev now.
  { batch: 21, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], dev: true, gate: true },
  // Fresh batch 22, first try (text and PDF): enquiry items 94.2% precision / 99.5% recall, qty 91.5% (a "Qty in Stock" column
  // before "Qty Required", "Item: 12" in a chat); quotes 100%: dev now.
  { batch: 22, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], dev: true, gate: true },
  // Fresh batch 23, first try (text and PDF): every field >= 99.5%, quotes 100%, but one shape at 33% ("need 10 butterfly valve",
  // one case): dev now.
  { batch: 23, enquiries: 120, quotes: 48, gens: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], dev: true, gate: true },
]

function splitOf(spec: BatchSpec, id: string): 'dev' | 'held' {
  if (spec.dev) return 'dev'
  if (spec.batch === 0) return hash(id) % 10 < 3 ? 'held' : 'dev'
  return 'held'
}

export function buildBatch(spec: BatchSpec): CorpusCase[] {
  const out: CorpusCase[] = []
  const eTemplates = ENQUIRY_TEMPLATES.filter(t => spec.gens.includes(t.gen))
  const qTemplates = QUOTE_TEMPLATES.filter(t => spec.gens.includes(t.gen))
  // A later batch leans on its own new templates, so they are tried with enough cases.
  const newest = Math.max(...spec.gens)
  const boost = <T extends { gen: number; weight: number }>(xs: T[]) => xs.map(x => ({ ...x, weight: x.weight * (newest > 0 && x.gen === newest ? 3 : 1) }))
  const eT = boost(eTemplates)
  const qT = boost(qTemplates)
  for (let i = 0; i < spec.enquiries; i++) {
    const id = `e${spec.batch}-${String(i).padStart(3, '0')}`
    const r = rng(`enquiry/${spec.batch}/${i}`)
    const t = weighted(r, eT)
    const d = t.make(r)
    const medium = pickMedium(r, d.media)
    const hasHead = d.doc.blocks.some(b => b.k === 'table' && b.head !== null)
    const c: EnquiryCase = {
      kind: 'enquiry',
      id,
      gen: t.gen,
      batch: spec.batch,
      split: splitOf(spec, id),
      shape: t.shape,
      medium,
      doc: d.doc,
      textStyle: textStyle(r, hasHead),
      truth: d.truth,
    }
    if (medium === 'image' || medium === 'scan') c.shot = shotFor(r, c)
    out.push(c)
  }
  for (let i = 0; i < spec.quotes; i++) {
    const id = `q${spec.batch}-${String(i).padStart(3, '0')}`
    const r = rng(`quote/${spec.batch}/${i}`)
    const t = weighted(r, qT)
    const d = t.make(r)
    const medium = pickMedium(r, d.media)
    const c: QuoteCase = {
      kind: 'quote',
      id,
      gen: t.gen,
      batch: spec.batch,
      split: splitOf(spec, id),
      shape: t.shape,
      medium,
      doc: d.doc,
      textStyle: textStyle(r, true),
      rfq: d.rfq,
      truth: d.truth,
    }
    if (medium === 'image' || medium === 'scan') c.shot = shotFor(r, c)
    out.push(c)
  }
  return out
}

export function batch(n: number): CorpusCase[] {
  const spec = BATCHES.find(b => b.batch === n)
  if (!spec) throw new Error(`no batch ${n}`)
  return buildBatch(spec)
}
