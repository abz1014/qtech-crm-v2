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
}

/**
 * The p_items of convert_rfq_to_order. `typedPrices` holds a selling price for items the quotation never priced. A line with a
 * single quote and the choice of that quote sends no quote_line_id (the database picks the only one); "Not sourced yet" on a line
 * with several quotes sends none, which leaves it unsourced.
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
    if (it.quotedUnitPriceNet === null) {
      const typed = typedPrices[it.id]
      if (typed !== null && typed !== undefined && typed > 0) line.unit_price_net = typed
    }
    return line
  })
}

/** Items that still have no selling price (the quotation did not price them and none was typed). */
export function unpricedItems(items: readonly ConvertItem[], typedPrices: Readonly<Record<string, number | null>>): ConvertItem[] {
  return items.filter(it => it.quotedUnitPriceNet === null && !(typedPrices[it.id] !== null && typedPrices[it.id] !== undefined && (typedPrices[it.id] as number) > 0))
}
