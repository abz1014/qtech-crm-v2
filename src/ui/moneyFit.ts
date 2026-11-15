/**
 * `fit`: how many ems the figure is wide, roughly (Geist tabular digits are about 0.6 em, separators about 0.3 em),
 * plus a little room, so the font size that fills the tile is 100cqi / this.
 */
export function fitEms(text: string): number {
  let ems = 0
  for (const ch of text) ems += /[0-9−-]/.test(ch) ? 0.6 : 0.3
  return Math.round((ems + 0.3) * 100) / 100
}
