import { parseAmount } from '@/lib/number'

/*
 * A price typed into a supplier reply (HW-48). Suppliers write prices the way they appear in a quote: "PKR 1,200/-",
 * "Rs. 1,200", "1,200/-", "USD 12.50". The currency follows the supplier and is shown beside the box, so a currency word
 * in front and the "/-" at the end are dropped before the number is read. Anything else that is not a number gets a plain
 * reason next to the box, never only a disabled Save reply.
 */

/** "PKR 1,200/-" reads 1200; "1,200/-" reads 1200; "-5" reads -5; text that is not a price reads null. */
export function parseReplyPrice(text: string): number | null {
  const bare = text
    .trim()
    .replace(/^(?:pkr|rs|usd|eur|gbp|aed|sar|cny|rmb|jpy|chf)\.?\s*/i, '') // a currency word in front: PKR, Rs., USD
    .replace(/\s*\/-?\s*$/, '') // the "/-" (or "/") after a whole amount
  return parseAmount(bare)
}

/** Why the typed text is not a price that can be saved, as one sentence for the person; null when it is fine or empty. */
export function replyPriceProblem(text: string): string | null {
  if (!text.trim()) return null
  const n = parseReplyPrice(text)
  if (n === null) return 'Type the price as a number, like 1200.'
  if (n < 0) return "A price can't be below zero."
  if (n === 0) return 'Type a price above zero, or leave it empty.'
  return null
}
