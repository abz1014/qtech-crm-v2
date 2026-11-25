/*
 * Is typed search text something a company could be called? (screen review 2026-11-24, item 20: Search offered
 * "Add “PO-988374” as a new company".) Search, the company picker and the Companies list offer "Add “X” as a new company"
 * only for name-like text: it has a letter in any script (an Urdu name counts), and it is not a document number or a phone
 * number. Real names with a figure in them stay names ("3M", "ABB 2", "Plant 7 Engineering").
 */

/** A reference the CRM or a customer prints: PO-988374, RFQ-0012, QT-26-0003 Rev 1, QTS-ABC-12, INV 44, ORD-0002, Job 139, O-45. */
const DOCUMENT_NUMBER = /^(po|rfq|rfqs|qt|qts|quote|quotation|inv|invoice|ord|order|so|dc|grn|cn|dn|pi|job|o)\s*[-#:/.\s]*\s*(no\.?\s*)?\d[\w\s\-/.]*$/i

export function looksLikeCompanyName(text: string): boolean {
  const t = text.trim()
  if (!/\p{L}/u.test(t)) return false
  if (DOCUMENT_NUMBER.test(t)) return false
  // One word that is mostly figures ("X988374", "26-0003A") is a code, not a name.
  if (!/\s/.test(t)) {
    const digits = t.replace(/\D/g, '').length
    if (digits >= 3 && digits * 2 > t.length) return false
  }
  return true
}
