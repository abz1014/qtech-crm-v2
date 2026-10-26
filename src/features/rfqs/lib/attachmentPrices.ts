/*
 * Does a file being added carry prices? (migration 0100, attachments.has_prices; plan: "files that carry prices are hidden from engineers")
 *
 * An engineer reads no file tagged true, and the database refuses an engineer's insert with true, so:
 *   - an engineer's upload is false (a site photo, a nameplate: they cannot tag a file, and need not);
 *   - a photo that answers a question about the enquiry is false (a nameplate, a site photo);
 *   - a picture on an ORDER is false (a site photo), as the 0100 backfill treats it;
 *   - everything else is true: the customer's PO, a supplier's quote, the enquiry PDF, a file from capture or intake.
 * The admin can flip any file with "Has prices: hide from engineers" on its row.
 */
export function attachmentHasPrices(input: { role: string; orderId?: string | null; clarificationId?: string | null; mime: string }): boolean {
  if (input.role === 'engineer') return false
  if (input.clarificationId) return false
  if (input.orderId && input.mime.startsWith('image/')) return false
  return true
}
