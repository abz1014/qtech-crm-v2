import type { CSSProperties } from 'react'
import { fitEms } from '@/ui/moneyFit'

/*
 * Summary tiles that never cut a figure (audit 1, blocker 2). A figure's width is known from its text (fitEms, the same measure
 * Money's `fit` uses). SumBar draws its own tiles and figures, so the page side sizes the tiles instead: each tile is at least as
 * wide as the widest figure needs at the tile size, and the tiles wrap onto more rows (one per row at the narrowest).
 */

/** The CSS variable a SumBar wrapper sets (SUM_FIT reads it): the widest figure's width in ems, with a floor for short figures. */
export function sumFitVars(texts: ReadonlyArray<string | null | undefined>): CSSProperties {
  const em = Math.max(4, ...texts.map(t => (t ? fitEms(t) : 0)))
  return { ['--sum-em' as string]: String(em) }
}

/**
 * The SumBar className for fitted tiles: a wrapping row of tiles (no empty cells: the last row's tiles grow to fill it), each at
 * least as wide as the widest figure needs (text-xl, text-lg on a phone), plus the "PKR " prefix and the card padding.
 */
export const SUM_FIT =
  'flex flex-wrap [&>div]:min-w-0 [&>div]:flex-[1_1_calc(var(--sum-em)*var(--text-xl)+2.5rem+2*var(--card-pad))] max-sm:[&>div]:flex-[1_1_calc(var(--sum-em)*var(--text-lg)+2.5rem+2rem)]'
