/** The user-perceived characters of a word (an emoji, a flag or a letter with its marks stays whole; never half a surrogate pair). */
type GraphemeSegmenter = new (locale: undefined, opts: { granularity: 'grapheme' }) => { segment(s: string): Iterable<{ segment: string }> }

function graphemes(word: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(word), s => s.segment)
  return Array.from(word)
}

const LETTERED = /^[\p{L}\p{N}]/u

/**
 * "Ayesha Rana" -> "AR"; one name -> first two letters; nothing -> "?".
 * Words that do not start with a letter or digit (an emoji, "-") are passed over when the name has lettered words (HE-15).
 */
export function initials(name: string): string {
  const all = name.trim().split(/\s+/).filter(Boolean)
  if (all.length === 0) return '?'
  const lettered = all.filter(w => LETTERED.test(w))
  const parts = lettered.length ? lettered : all
  if (parts.length === 1) return graphemes(parts[0]).slice(0, 2).join('').toUpperCase()
  return (graphemes(parts[0])[0] + graphemes(parts[parts.length - 1])[0]).toUpperCase()
}
