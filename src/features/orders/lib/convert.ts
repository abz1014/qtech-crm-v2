// O01: turning an RFQ into an order. Pure and framework-free.
// The supplier for each line is CHOSEN BY A PERSON (owner decision 2026-10-29): nothing here picks the lowest, the first or the only
// quote. A line nobody quoted is left unsourced. Choosing "Service" marks the line a service (no goods leg).

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

/** A line's choice: a quote line id, or one of the two words. */
export type SupplierChoice = string | 'none' | 'service'

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
