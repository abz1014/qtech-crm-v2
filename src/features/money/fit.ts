import type { CSSProperties } from 'react'

/*
 * Big figures that must stay whole (audit 1, blocker 2): an amount never breaks inside its digits and never runs out of its card.
 * A figure's width is known from its text: Geist's tabular digits are about 0.6 em wide, a comma or a point about 0.3 em.
 *
 *  - figureEm(text): the figure's width in em (the "PKR" prefix not counted).
 *  - fitFigure(text, max, room): the font size for a figure inside a box marked FIT_BOX: `max` (a type token) while the figure
 *    fits, then smaller, so it always fits the box on one line. `room` is the width beside the figure in the same line (the
 *    prefix). Uses container units, so the box is the card, not the window.
 *  - tileBasis(texts): for a row of tiles (SumBar), the narrowest a tile may be so its longest figure fits at full size. Tiles
 *    flow onto more rows, one per row at the narrowest, instead of cutting the figure.
 *
 * Money (src/ui/Money.tsx) has no `fit` option yet; this is the page side of it. Keep the numbers here in step with it.
 */
const NARROW = /[,.\s]/

export function figureEm(text: string): number {
  let em = 0
  for (const ch of text) em += NARROW.test(ch) ? 0.3 : 0.62
  return Math.round(em * 100) / 100
}

/** The box a fitted figure measures itself against (a CSS size container on its inline axis). */
export const FIT_BOX = '[container-type:inline-size]'

export function fitFigure(text: string, max: string, room = '0rem'): CSSProperties {
  const em = Math.max(figureEm(text), 1)
  return { fontSize: `min(${max}, calc((100cqi - ${room}) / ${em}))`, whiteSpace: 'nowrap' }
}

/**
 * The CSS variable a SumBar wrapper sets (SUM_FIT reads it): the widest figure's em width. The tile is then that many ems of the
 * tile figure (text-xl, text-lg on a phone), plus the "PKR " prefix and the card padding.
 */
export function sumFitVars(texts: ReadonlyArray<string | null | undefined>): CSSProperties {
  const em = Math.max(4, ...texts.map(t => (t ? figureEm(t) : 0)))
  return { ['--sum-em' as string]: String(em) }
}

/**
 * The SumBar className for fitted tiles: a wrapping row of tiles (no empty cells: the last row's tiles grow to fill it), each at
 * least as wide as the widest figure needs.
 */
export const SUM_FIT =
  'flex flex-wrap [&>div]:min-w-0 [&>div]:flex-[1_1_calc(var(--sum-em)*var(--text-xl)+2.5rem+2*var(--card-pad))] max-sm:[&>div]:flex-[1_1_calc(var(--sum-em)*var(--text-lg)+2.5rem+2rem)]'
