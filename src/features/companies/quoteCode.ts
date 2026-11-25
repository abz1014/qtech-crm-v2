/*
 * A customer's quote code (0147): the short letters in a quotation number, QTS-<code>-4810. 2 to 6 capital letters, one per
 * customer. The suggestion is the initials of the name ("Ibrahim Fibres Limited" is IFL), moved on to a free code when another
 * customer already has it.
 */
export const QUOTE_CODE_RE = /^[A-Z]{2,6}$/

/** What a person typed, as it is stored: no spaces, capitals. */
export const normalizeQuoteCode = (text: string): string => text.replace(/\s+/g, '').toUpperCase()

/** The sentence for a code that cannot be saved, or null when it is fine. */
export function quoteCodeProblem(text: string): string | null {
  const v = normalizeQuoteCode(text)
  if (v === '') return 'Enter the customer code, for example IFL.'
  if (!/^[A-Z]+$/.test(v)) return 'Use letters only, for example IFL.'
  if (!QUOTE_CODE_RE.test(v)) return 'Use 2 to 6 letters.'
  return null
}

const FILLER = new Set(['AND', 'OF', 'THE', 'FOR'])

/** "Ibrahim Fibres Limited" -> IFL. Words in brackets ("(Pvt.)") are left out. A one-word name gives its first three letters. */
export function suggestQuoteCode(name: string, taken: ReadonlySet<string> = new Set()): string {
  const plain = name.replace(/\([^)]*\)/g, ' ')
  const words = plain
    .split(/[^A-Za-z]+/)
    .map(w => w.toUpperCase())
    .filter(w => w && !FILLER.has(w))
  let base = words.map(w => w[0]).join('').slice(0, 6)
  if (base.length < 2) base = (words[0] ?? '').slice(0, 3)
  if (base.length < 2) base = 'CU'
  if (!taken.has(base)) return base
  // Taken: one more letter from the name, then any letter, so the suggestion is always free.
  const stem = base.slice(0, 5)
  const extra = [...(words.join('').slice(1) + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')]
  for (const c of extra) if (!taken.has(stem + c)) return stem + c
  return base
}
