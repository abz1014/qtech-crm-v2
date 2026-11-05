/*
 * The TypeScript twin of qtech_private.clean_item_text (migration 0135): item text without prices or supplier names.
 *
 * The old system kept supplier breakdowns inside its free text ("Supplier breakdown: • ITEM#30: <item> x6 — <supplier> @ Rs 2,505/unit
 * • ITEM#31: ..."). An engineer sees no price and no supplier name, so the import writes the cleaned text into the item description
 * and the database moves the original to public.imported_notes (admin and sales only). The database cleans too, whoever writes
 * (trigger keep_imported_text); this twin keeps the import's own rows clean before they are sent, and supabase/tests/0135 pins the
 * same cases. Keep both in step.
 *
 *  - breakdown text (it names "Supplier breakdown", "ITEM#" or a bullet): each bullet loses its "ITEM#n:" and everything from " — " or
 *    "@" on; a bullet that still names Rs, PKR or /unit is dropped; the first item is kept and " +N more" says how many others there were
 *  - plain text: a part after " — " that names a price is dropped, "@ ..." is cut; text with no marker at all is returned as it is
 *  - nothing left: "Imported item", never the price
 */
const PRICE = String.raw`(\b(?:rs|pkr)\.?\s*[0-9]|[0-9]\s*(?:rs|pkr)\b(?!-)|\/unit)`
const PRICE_RE = new RegExp(PRICE, 'i')
const ANY_MARKER_RE = new RegExp(String.raw`(supplier\s+breakdown|item\s*#|•|@|` + PRICE + ')', 'i')
const BREAKDOWN_RE = /(supplier\s+breakdown|item\s*#|•)/i

export function cleanItemText(p: string): string
export function cleanItemText(p: string | null): string | null
export function cleanItemText(p: string | null): string | null {
  if (p === null) return null
  if (!ANY_MARKER_RE.test(p)) return p
  const breakdown = BREAKDOWN_RE.test(p)
  const v = p.replace(/supplier\s+breakdown\s*:?/gi, '')
  const parts = breakdown ? v.split(/\s*•\s*|\s*[\r\n]+\s*/) : v.split(/\s—\s/)
  const kept: string[] = []
  for (const raw of parts) {
    let piece = raw.replace(/item\s*#\s*\d+\s*:?\s*/gi, '')
    if (breakdown) piece = piece.replace(/\s—\s[\s\S]*$/, '')
    piece = piece.replace(/@[\s\S]*$/, '').replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
    if (piece === '' || PRICE_RE.test(piece)) continue
    kept.push(piece)
  }
  if (kept.length === 0) return 'Imported item'
  if (breakdown) return kept[0]! + (kept.length > 1 ? ` +${kept.length - 1} more` : '')
  return kept.join(' — ')
}
