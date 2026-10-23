// O01: turning an RFQ into an order. Pure and framework-free.
// The supplier for each line comes from the lowest comparable quote (comparePrices, at today's rates). A line with one quote
// takes it; a line with several that cannot be compared (no usable rate) is left "not sourced yet" for the person to choose;
// a line nobody quoted is left unsourced. Choosing "Service" marks the line a service (no goods leg).

import { comparePrices, type RateTable } from '@/features/rfqs/lib/comparePrices'

export interface ConvertItem {
  id: string
  description: string
  qty: number
  unit: string | null
  /** rfq_items.quoted_unit_price_net: what the customer was quoted. Null when no quotation priced it. */
  quotedUnitPriceNet: number | null
  brandName?: string | null
  familyName?: string | null
}

export interface ConvertQuote {
  /** supplier_quote_lines.id */
  lineId: string
  itemId: string
  supplierName: string
  unitPrice: number
  currency: string
}

/** A line's choice: a quote line id, or one of the two words. */
export type SupplierChoice = string | 'none' | 'service'

export interface ChoiceOption {
  value: SupplierChoice
  label: string
  lowest?: boolean
}

export interface LineChoice {
  itemId: string
  choice: SupplierChoice
  options: ChoiceOption[]
  /** The choice was made by the lowest-quote rule (so the dialog can say so). */
  fromLowest: boolean
}

const money = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** The default supplier for every item, and the options the person may change it to. */
export function defaultChoices(items: readonly ConvertItem[], quotes: readonly ConvertQuote[], rates: RateTable): LineChoice[] {
  return items.map(item => {
    const mine = quotes.filter(q => q.itemId === item.id)
    const cmp = comparePrices(
      mine.map(q => ({ id: q.lineId, amount: q.unitPrice, currency: q.currency })),
      rates,
    )
    const lowest = new Set(cmp.lowestIds)
    const options: ChoiceOption[] = mine.map(q => ({
      value: q.lineId,
      label: `${q.supplierName}, ${q.currency} ${money(q.unitPrice)}`,
      lowest: lowest.has(q.lineId),
    }))
    if (mine.length !== 1) options.push({ value: 'none', label: 'Not sourced yet' })
    options.push({ value: 'service', label: 'Service, no supplier' })

    let choice: SupplierChoice = 'none'
    let fromLowest = false
    if (cmp.lowestIds.length > 0) {
      choice = cmp.lowestIds[0]
      fromLowest = true
    } else if (mine.length === 1) {
      choice = mine[0].lineId
    }
    if (mine.length === 0) choice = 'none'
    return { itemId: item.id, choice, options, fromLowest }
  })
}

export interface ConvertPayloadLine {
  rfq_item_id: string
  quote_line_id?: string
  unit_price_net?: number
  qty?: number
  is_service?: boolean
  /** "Not sourced yet", chosen or true by default: the database then gives the line no supplier instead of inferring the rank-1 quote (0094, HW-47). */
  not_sourced?: boolean
  /** The RFQ quantity the dialog showed: the database refuses the order if it changed since (0094, HW-60). */
  expected_qty?: number
}

/**
 * The p_items of convert_rfq_to_order. `typedPrices` holds a selling price for items the quotation never priced. A line with a
 * single quote and the choice of that quote sends no quote_line_id (the database picks the only one); "Not sourced yet" sends
 * not_sourced: true, which the database honours (no supplier), whatever quotes the item has.
 */
export function buildPayload(
  items: readonly ConvertItem[],
  choices: Readonly<Record<string, SupplierChoice>>,
  typedPrices: Readonly<Record<string, number | null>> = {},
): ConvertPayloadLine[] {
  return items.map(it => {
    const line: ConvertPayloadLine = { rfq_item_id: it.id }
    const c = choices[it.id] ?? 'none'
    if (c === 'service') line.is_service = true
    else if (c !== 'none') line.quote_line_id = c
    else line.not_sourced = true
    if (it.quotedUnitPriceNet === null) {
      const typed = typedPrices[it.id]
      if (typed !== null && typed !== undefined && typed > 0) line.unit_price_net = typed
    }
    return line
  })
}

/**
 * A line that is work, not goods: nobody quoted it and it reads as commissioning, installation, start-up or similar (or its family is a
 * service one, "Commissioning service"). Mark won then starts it on "Service, no supplier" instead of "Not sourced yet" (HW-49).
 * A line a supplier quoted is goods, whatever it says. Narrow on purpose: "Calibration gas" is goods, "Commissioning and loop check" is not.
 */
const SERVICE_START = /^\s*(commissioning|installation|installing|site acceptance|start[-\s]?up|loop check|supervision|training)\b/i
const SERVICE_FAMILY = /\b(commissioning|service)s?\b/i
export function looksLikeService(description: string, familyName?: string | null): boolean {
  return SERVICE_START.test(description) || /\bcommissioning\b/i.test(description) || Boolean(familyName && SERVICE_FAMILY.test(familyName))
}

/** Items that still have no selling price (the quotation did not price them and none was typed). */
export function unpricedItems(items: readonly ConvertItem[], typedPrices: Readonly<Record<string, number | null>>): ConvertItem[] {
  return items.filter(it => it.quotedUnitPriceNet === null && !(typedPrices[it.id] !== null && typedPrices[it.id] !== undefined && (typedPrices[it.id] as number) > 0))
}

/** Item families that are normally installed and commissioned by us (analysers, control and automation systems); the family name is read, so a new family needs no code. */
const FAMILY_WORDS = /\b(analy[sz]ers?|plc|dcs|scada|control systems?|automation|commissioning|installation)\b/i
const COMMISSIONING_WORDS = /\b(commission(ing)?|install(ation|ed)?|calibrat(e|ion)|start[-\s]?up|loop check|site acceptance|SAT)\b/i

export interface CommissioningGuess {
  needs: boolean
  /** Plain words for the hint under the toggle: why it is on. Null when it is off. */
  reason: string | null
}

/**
 * Whether a converted order probably needs commissioning, so the toggle starts in the right place and the person usually taps nothing.
 * On when an ordered line is a service, or its description speaks of commissioning, installation or calibration. A wrong guess is one tap.
 */
export function guessCommissioning(
  lines: ReadonlyArray<{ number: number; description: string; familyName?: string | null }>,
  choices: Readonly<Record<string, SupplierChoice>>,
  ids: Readonly<Record<number, string>>,
): CommissioningGuess {
  for (const l of lines) {
    if (choices[ids[l.number]] === 'service') return { needs: true, reason: `line ${l.number} is a service` }
    if (l.familyName && FAMILY_WORDS.test(l.familyName)) return { needs: true, reason: `line ${l.number} is in the ${l.familyName} family` }
    if (COMMISSIONING_WORDS.test(l.description)) return { needs: true, reason: `line ${l.number} mentions commissioning or installation` }
  }
  return { needs: false, reason: null }
}
