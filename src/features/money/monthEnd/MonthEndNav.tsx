import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { MONTH_END_VIEWS } from '@/features/money/monthEnd/monthEndViews'

/*
 * The strip under the Money views while Month-end is open (g2-month-end, "Month-end views"). Every view task adds its
 * own entry here: M12 brings Bank tick; the checklist and the report tabs (M10) are the mockup's others.
 */
export function MonthEndNav({
  active,
  counts,
  search = '',
}: {
  active: string
  counts?: Partial<Record<string, number>>
  search?: string
}) {
  return (
    <nav
      aria-label="Month-end views"
      className="inline-flex max-w-full gap-[2px] justify-self-start overflow-x-auto rounded bg-selected p-[2px]"
    >
      {MONTH_END_VIEWS.map(v => {
        const count = counts?.[v.key]
        const on = v.key === active
        return (
          <NavLink
            key={v.key}
            to={{ pathname: v.to, search }}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'inline-flex h-[26px] shrink-0 items-center gap-[6px] whitespace-nowrap rounded border px-3 text-xs font-medium transition-colors duration-fast ease-out',
              on ? 'border-line-strong bg-surface text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {v.label}
            {count !== undefined ? <span className={cn('num font-regular', on ? 'text-fg-2' : 'text-fg-muted')}>{count}</span> : null}
          </NavLink>
        )
      })}
    </nav>
  )
}
