import { cloneElement, useState, type CSSProperties, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { preloadTooltip, useTooltipImpl } from '@/ui/tooltipStore'
import type { TooltipProps } from '@/ui/tooltipImpl'

/*
 * Tooltip (INVENTORY: U03; D08 section 10). Short, optional, never the only place
 * something is said. Forest .qb-tip__body: brand-950, e3 shadow, 12 px corners, no arrow, 300px max. Opens after 400 ms
 * of hover or at once on keyboard focus; closes on Esc, blur or leaving.
 * Phones have no hover: put the text on screen instead.
 *
 * Light and Radix halves (perf, as Popover.tsx): Radix Tooltip and its positioning library are about 15 KB compressed, on every list
 * and the Job page. Until the Radix half (tooltipImpl.tsx) is here, a tooltip draws only its element, and the first hover or focus
 * fetches it. AppShell fetches it once the page's content is drawn, so on a normal visit it is there before anyone points at anything.
 * A tooltip focused before the swap opens as soon as the Radix half arrives.
 */
export function Tooltip(props: TooltipProps) {
  const mod = useTooltipImpl()
  const [wanted, setWanted] = useState(false)
  if (mod) return <mod.TooltipImpl {...props} defaultOpen={wanted} />
  const child = props.children as ReactElement<{ onPointerEnter?: (e: PointerEvent) => void; onFocus?: (e: FocusEvent) => void }>
  const reach = () => void preloadTooltip()
  const focus = () => {
    setWanted(true)
    reach()
  }
  if (props.forDisabled) {
    return (
      <span tabIndex={0} className="inline-flex rounded-control" onPointerEnter={reach} onFocus={focus}>
        {child}
      </span>
    )
  }
  return cloneElement(child, {
    onPointerEnter: (e: PointerEvent) => {
      child.props.onPointerEnter?.(e)
      reach()
    },
    onFocus: (e: FocusEvent) => {
      child.props.onFocus?.(e)
      focus()
    },
  })
}

/*
 * TruncateTip (components-10 "Long label, revealed"; DataTable cells with a fixed width): text that truncates with an
 * ellipsis and shows the full text in a tooltip on hover, but only when it is actually cut off. The tooltip text is the
 * element's own text, so pass plain text as children. The full text is also what a screen reader reads (nothing is removed).
 * Until the Radix half is here it is the same span, and pointing at it fetches the Radix half.
 */
export function TruncateTip({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const mod = useTooltipImpl()
  if (mod) return <mod.TruncateTipImpl className={className} style={style}>{children}</mod.TruncateTipImpl>
  return (
    <span data-truncate="" style={style} className={cn('block truncate', className)} onPointerEnter={() => void preloadTooltip()}>
      {children}
    </span>
  )
}
