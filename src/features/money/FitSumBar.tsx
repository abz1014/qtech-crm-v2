import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { formatAmount } from '@/lib/money'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { SumBar, type SumBarItem } from '@/ui/SumBar'
import { SUM_FIT, sumFitVars } from '@/features/money/fit'

/** The text a tile's figure shows (what its width depends on). */
function figureText(i: SumBarItem): string | null {
  if (i.count !== undefined) return String(i.count)
  if (i.figure !== undefined) return Array.isArray(i.figure) ? i.figure.reduce((a, b) => (b.length > a.length ? b : a), '') : i.figure
  if (i.amount === null || i.amount === undefined) return null
  return formatAmount(i.amount, i.paisa ?? 'never')
}

/**
 * SumBar whose tiles never cut a figure (audit 1, blocker 2): the tiles wrap onto more rows, as wide as the widest figure needs, one
 * per row when the card is narrow. The phone lines form (`phone="lines"` below 640) is drawn as SumBar draws it.
 */
export function FitSumBar(props: ComponentProps<typeof SumBar>) {
  const narrow = useMediaQuery('(max-width: 639px)')
  const lines = props.phone === 'lines' && narrow
  if (lines) return <SumBar {...props} />
  return (
    <div className="contents" style={sumFitVars(props.items.map(figureText))}>
      <SumBar {...props} className={cn(props.className, SUM_FIT)} />
    </div>
  )
}
