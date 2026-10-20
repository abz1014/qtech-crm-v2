/**
 * Payment terms typed once (entry-burden J5/J7): the days Mark won pre-fills are read from the payment terms written on the
 * quotation, when they say a number of days ("30 days from invoice", "Net 45", "45 days credit") or advance ("100% advance",
 * "against delivery" = 0). Anything else (or two different numbers) returns null, and the dialog falls back to the last order.
 */
export function daysFromTermsText(text: string | null | undefined): number | null {
  if (!text) return null
  const t = text.toLowerCase()
  const found = new Set<number>()
  for (const m of t.matchAll(/\b(\d{1,3})\s*-?\s*days?\b/g)) found.add(Number(m[1]))
  for (const m of t.matchAll(/\bnet\s*(\d{1,3})\b/g)) found.add(Number(m[1]))
  if (found.size === 1) return [...found][0]
  if (found.size > 1) return null
  if (/\badvance\b|\bcash with order\b|\bagainst (?:delivery|proforma)\b|\bcod\b/.test(t)) return 0
  return null
}
