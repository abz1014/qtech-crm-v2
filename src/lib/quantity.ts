/**
 * ONE way to show a quantity on screen (screen review 25 Nov, item 28: "1 no", "nos", "pcs" and a bare "2" all appeared).
 * Counted things read "1 no" and "2 nos", the unit the app stores as standard, whether the item was saved with "nos", "pcs",
 * "each" or no unit at all. Any other unit (m, kg, set, lot) is shown as stored: "150 m". Screen text only: the PDFs keep
 * their own layouts (the quote PDF copies the owner's Excel template and prints counted things as the bare number).
 */

/** The units that mean "counted things", read case-blind. An empty unit counts too. */
const COUNT_UNITS = new Set(['', 'no', 'no.', 'nos', "no's", 'pc', 'pcs', 'piece', 'pieces', 'each', 'ea', 'unit', 'units'])

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** True when the unit means counted things ("nos", "pcs", "each", none). */
export function isCountUnit(unit: string | null | undefined): boolean {
  return COUNT_UNITS.has(oneLine(unit ?? '').toLowerCase())
}

/** The word after a quantity: "no" for exactly 1, "nos" otherwise, for counted things. Other units as stored. */
export function unitWord(qty: number, unit: string | null | undefined): string {
  if (isCountUnit(unit)) return qty === 1 ? 'no' : 'nos'
  return oneLine(unit ?? '')
}

/** The number as typed: grouped, up to 3 decimals ("1,200", "2.5"). */
export function qtyNumber(qty: number): string {
  return qty.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

/** "1 no", "2 nos", "150 m". */
export function qtyWithUnit(qty: number, unit: string | null | undefined): string {
  return `${qtyNumber(qty)} ${unitWord(qty, unit)}`
}
