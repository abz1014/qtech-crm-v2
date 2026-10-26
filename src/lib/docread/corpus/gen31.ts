// Template generation 31 (fix/ocr-grid-tables): ruled grid tables as small screenshots, the shape the owner's own enquiries came in
// (an Excel range pasted as a picture into a chat or an email), written before the reader was changed for them and first measured
// blind on a held-out batch (corpus.ts, batches 33 and 34).
//  - grid_uom_last: a table of four columns, "Sr. | Material Name | UOM | QTY", a heavy ruled grid with a border on every cell; the
//    name column is narrow, so long names wrap onto two or three lines inside their cell while the cells beside them stay on one;
//  - grid_remarks: five columns with a free-text "Required For" (a department, an urgency) between the description and the
//    quantity, "SR. | DESCRIPTION | REQUIRED FOR | QTY | UOM", the remarks wrapping over several lines too; the remarks are not items;
//  - grid_remarks_text: the same table as pasted text or a PDF, for the parser's side (the remarks column is not description).
// Every product is invented from vocab.ts; the departments and companies are fictional.

import type { Block, Doc, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { Rng } from './rng'
import { unitFamily, writeUnit } from './units'
import { parts, type Part } from './vocab'

const DEPARTMENTS = ['Boiler House', 'Spinning Unit-2', 'Kiln Section', 'Packing Plant', 'Water Treatment Plant', 'Utilities', 'Process Control', 'Engineering Stores', 'Mechanical Workshop']
const REMARK = [
  (d: string) => `For ${d}`,
  (d: string) => `Most Urgent Demand For ${d} Deptt.`,
  (d: string) => `Required for ${d} shutdown`,
  (d: string) => `${d} Deptt.`,
  (d: string) => `Urgent, for ${d}`,
  (d: string) => `Spare for ${d}`,
]

/** How a cell of an item's description is written: natural, capitals, a make in brackets, a model after it. */
function describe(r: Rng, p: Part): string {
  const base = r.pick([p.plain, p.caps, p.plain, p.caps])
  const brand = p.brand && !base.toLowerCase().includes(p.brand.toLowerCase()) && r.chance(0.5) ? ` (${p.brand})` : ''
  return `${base}${brand}`.replace(/\s+/g, ' ').trim()
}

function rowsOf(r: Rng, n: number, style: { unitRegister: 'caps' | 'title' | 'any' }): { items: Array<{ cell: string; qty: number; unit: string; part: string | null }> } {
  const ps = parts(r, n)
  const items = ps.map(p => {
    const fam = unitFamily(r.pick(p.units)) as string
    // A sheet often mixes "PCS" and "Pcs" in one column: the unit is kept as written.
    const unit = writeUnit(r, fam, r.chance(0.3) ? 'title' : style.unitRegister)
    return { cell: describe(r, p), qty: Math.ceil(p.qty(r)), unit, part: p.part }
  })
  return { items }
}

const truthOf = (items: Array<{ cell: string; qty: number; unit: string; part: string | null }>): ItemTruth[] =>
  items.map(i => ({ description: i.cell, qty: i.qty, unit: i.unit, ...(i.part ? { part: i.part } : {}) }))

/** A grid as a picture: a heavy or a light ruled grid, a few hundred pixels wide, as cropped out of a sheet. */
function gridDoc(r: Rng, table: Extract<Block, { k: 'table' }>): Doc {
  return {
    look: 'email',
    blocks: [{ ...table, ruled: true, maxWidth: r.int(430, 640), ruleColor: r.pick(['#000000', '#000000', '#333333', '#808080', '#bfbfbf']), shaded: false }],
  }
}

export const gridUomLast: EnquiryTemplate = r => {
  const n = r.int(6, 30)
  const { items } = rowsOf(r, n, { unitRegister: r.pick(['caps', 'caps', 'any'] as const) })
  const head = r.pick([['Sr.', 'Material Name', 'UOM', 'QTY'], ['S.No', 'Item Description', 'Unit', 'Qty'], ['Sr No', 'Particulars', 'UOM', 'Quantity'], ['Sr.', 'Description', 'U/M', 'QTY']])
  const table: Extract<Block, { k: 'table' }> = {
    k: 'table',
    head,
    rows: items.map((it, i) => [String(i + 1), it.cell, it.unit, String(it.qty)]),
    widths: [0.08, 0.64, 0.14, 0.14],
    align: ['c', 'l', 'l', 'c'],
    ruled: true,
    descCol: 1,
  }
  return { doc: gridDoc(r, table), truth: { items: truthOf(items) }, media: ['image'] }
}

function remarksTable(r: Rng, n: number): { table: Extract<Block, { k: 'table' }>; items: ReturnType<typeof rowsOf>['items'] } {
  const { items } = rowsOf(r, n, { unitRegister: r.pick(['caps', 'caps', 'title'] as const) })
  const head = r.pick([['SR.', 'DESCRIPTION', 'REQUIRED FOR', 'QTY', 'UOM'], ['Sr. No.', 'Item Description', 'Required For', 'Qty', 'Unit'], ['S#', 'DESCRIPTION', 'REMARKS', 'QTY', 'UOM'], ['Sr.', 'Material', 'Purpose', 'Qty', 'UOM']])
  const dept = r.pick(DEPARTMENTS)
  const remark = r.pick(REMARK)
  const mixed = r.chance(0.5)
  return {
    items,
    table: {
      k: 'table',
      head,
      rows: items.map((it, i) => [String(i + 1), it.cell, remark(mixed && r.chance(0.5) ? r.pick(DEPARTMENTS) : dept), String(it.qty), it.unit]),
      widths: [0.07, 0.43, 0.28, 0.08, 0.1],
      align: ['c', 'l', 'c', 'c', 'c'],
      ruled: true,
      descCol: 1,
    },
  }
}

export const gridRemarks: EnquiryTemplate = r => {
  const { table, items } = remarksTable(r, r.int(3, 9))
  // The remarks wrap too, so the picture's rows are tall and the cells beside them hold one line.
  const doc = gridDoc(r, { ...table, maxWidth: r.int(520, 720) })
  return { doc, truth: { items: truthOf(items) }, media: ['image'] }
}

export const gridRemarksText: EnquiryTemplate = r => {
  const { table, items } = remarksTable(r, r.int(3, 14))
  const doc: Doc = { look: 'email', blocks: [{ k: 'text', text: r.pick(['Please quote the following items.', 'Kindly share your best rates for the below material.']) }, { k: 'gap' }, table] }
  return { doc, truth: { items: truthOf(items) }, media: ['text', 'pdf'] }
}

export const ENQUIRY_TEMPLATES_GEN31: Array<{ shape: string; make: EnquiryTemplate; weight: number }> = [
  { shape: 'grid_uom_last', make: gridUomLast, weight: 5 },
  { shape: 'grid_remarks', make: gridRemarks, weight: 4 },
  { shape: 'grid_remarks_text', make: gridRemarksText, weight: 2 },
]
