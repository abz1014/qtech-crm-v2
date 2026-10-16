/*
 * The expected-cost SUGGESTION (DATA_MODEL 5c item 4, Amendment A2b; M04). Pure.
 *
 *   Σ qty × supplier price × today's rate, per leg currency; a line that is on an issued PO uses that PO's line instead
 *   (the PO is what was actually agreed: its latest revision wins).
 *
 * It is "supplier price only": no freight, duty or service. It never writes anything. The panel offers it as a one-tap fill
 * for an expected cost that is still empty, and a value that was entered is never touched. Cost is counted per ORDER ITEM
 * through the leg the item is on, so one RFQ item split over several suppliers (A8) is several lines here, each with its own
 * supplier price, currency and PO line: nothing assumes one supplier per RFQ item.
 */

export interface EstItem {
  id: string
  qty: number
  /** order_items.supplier_unit_price, in the currency of its leg. */
  supplierUnitPrice: number | null
  legId: string | null
  isService: boolean
}

export interface EstLeg {
  id: string
  currency: string | null
}

/** The latest revision of an issued PO, one per leg. */
export interface EstPo {
  legId: string
  currency: string
  lines: readonly { orderItemId: string; qty: number; unitPrice: number }[]
}

export interface EstRate {
  rate: number
  ageDays: number
}

export interface EstLegResult {
  legId: string
  currency: string | null
  /** In the leg's own currency. */
  amount: number
  source: 'po' | 'prices' | 'po and prices'
  /** In PKR at today's rate; null when there is no usable rate (the leg is then left out of the total). */
  pkr: number | null
}

export interface CostEstimate {
  /** Σ in PKR of the legs that could be converted; null when nothing could be. */
  pkr: number | null
  legs: EstLegResult[]
  /** Goods lines with no supplier price (and no PO line): the estimate is short by these. */
  linesWithoutPrice: number
  /** Currencies (or "no currency") whose legs are not in the total, because there is no usable rate. */
  unconverted: string[]
}

/** A rate older than this is not used for money (the same 30 days as every other conversion). */
export const MAX_RATE_AGE_DAYS = 30

const r2 = (n: number) => Math.round(n * 100) / 100

export function estimateExpectedCost(input: { items: readonly EstItem[]; legs: readonly EstLeg[]; pos: readonly EstPo[]; rates: Readonly<Record<string, EstRate | undefined>> }): CostEstimate {
  const legById = new Map(input.legs.map(l => [l.id, l]))
  const poByLeg = new Map(input.pos.map(p => [p.legId, p]))
  const perLeg = new Map<string, { amount: number; fromPo: boolean; fromPrices: boolean }>()
  let withoutPrice = 0

  for (const it of input.items) {
    if (it.isService) continue
    const poLine = it.legId ? poByLeg.get(it.legId)?.lines.find(l => l.orderItemId === it.id) : undefined
    let amount: number | null = null
    let fromPo = false
    if (poLine) {
      amount = poLine.qty * poLine.unitPrice
      fromPo = true
    } else if (it.supplierUnitPrice !== null && it.legId) {
      amount = it.qty * it.supplierUnitPrice
    }
    if (amount === null) {
      withoutPrice += 1
      continue
    }
    const key = it.legId as string
    const cur = perLeg.get(key) ?? { amount: 0, fromPo: false, fromPrices: false }
    cur.amount += amount
    if (fromPo) cur.fromPo = true
    else cur.fromPrices = true
    perLeg.set(key, cur)
  }

  const legs: EstLegResult[] = []
  const unconverted = new Set<string>()
  let total = 0
  let any = false
  for (const [legId, v] of perLeg) {
    const currency = legById.get(legId)?.currency ?? null
    const amount = r2(v.amount)
    let pkr: number | null = null
    if (currency === 'PKR') pkr = amount
    else if (currency) {
      const rate = input.rates[currency]
      if (rate && rate.ageDays <= MAX_RATE_AGE_DAYS) pkr = r2(amount * rate.rate)
    }
    if (pkr === null) unconverted.add(currency ?? 'no currency')
    else {
      total += pkr
      any = true
    }
    legs.push({ legId, currency, amount, source: v.fromPo && v.fromPrices ? 'po and prices' : v.fromPo ? 'po' : 'prices', pkr })
  }
  legs.sort((a, b) => a.legId.localeCompare(b.legId))
  return { pkr: any ? r2(total) : null, legs, linesWithoutPrice: withoutPrice, unconverted: [...unconverted].sort() }
}
