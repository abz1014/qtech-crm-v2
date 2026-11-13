import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/*
 * StickyActionBar (round-2 spec 5.3 and 5.4): a detail page's phone action bar. Fixed to the bottom of the screen with a
 * safe-area pad; below md only. It holds the page's one primary (the same action as its NextStepBox, size="touch"), at most
 * one secondary (RFQ: Chase) and the More menu (`<MoreMenu touch side="top" />`).
 *
 * The page that uses it MUST also:
 *   - call `useMobileBar({ …, hideTabs: true })`, so the bottom tabs do not sit under this bar;
 *   - add `max-md:pb-[calc(var(--control-lg-h)+2rem)]` to its content, so the last row is not hidden behind the bar.
 * It replaces the three hand-rolled bars (RfqHeaderBlock `sticky bottom-0`, OrderHeaderBlock `PhoneSticky`, ChecklistPage).
 * Forest .qb-sticky-bar: a white bar with the e3 lift and 16 px top corners (was the navy band), so the buttons inside are the
 * ordinary light ones.
 */
export interface StickyActionBarProps {
  /** The page's one primary button (touch size). Stretches to fill the bar. */
  primary?: ReactNode
  /** At most one secondary button (touch size). */
  secondary?: ReactNode
  /** A `<MoreMenu touch side="top" />`. */
  more?: ReactNode
  /** Names the toolbar ("RFQ actions"). */
  label: string
  /** "toolbar" (default), or "region" where the bar is the screen's own named block (the engineer's On site buttons on a phone). */
  role?: 'toolbar' | 'region'
  className?: string
}

export function StickyActionBar({ primary, secondary, more, label, role = 'toolbar', className }: StickyActionBarProps) {
  return (
    <div
      role={role}
      aria-label={label}
      data-action-bar
      className={cn(
        'fixed inset-x-0 bottom-0 z-sticky flex items-center gap-2 rounded-t-card border-t bg-surface px-4 pb-[calc(var(--sp-3)+env(safe-area-inset-bottom,0px))] pt-3 text-fg shadow-e3 md:hidden',
        className,
      )}
    >
      {primary ? <div className="flex min-w-0 flex-1 [&>*]:flex-1">{primary}</div> : <span className="flex-1" />}
      {secondary}
      {more}
    </div>
  )
}
