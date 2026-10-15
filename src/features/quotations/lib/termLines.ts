/** The standard terms as separate lines: one per line of text, any leading "1." or "2)" removed (the PDF numbers them). */
export function termLines(notes: string | null): string[] {
  return (notes ?? '')
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean)
}
