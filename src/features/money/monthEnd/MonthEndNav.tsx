import { Fragment } from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useScrollActiveIntoView } from '@/lib/useScrollActiveIntoView'
import { MONTH_END_VIEWS } from '@/features/money/monthEnd/monthEndViews'

/*
 * The strip under the Money views while Month-end is open (g2-month-end, "Month-end views"): the checklist and the bank tick,
 * a divider, then the six reports. On a phone the same views are scrolling pills, the active one dark (m-chips).
 * `counts` carries the Checklist (checks with items) and Bank tick (items not ticked) figures; the month rides in the address.
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
  const strip = useScrollActiveIntoView<HTMLElement>()
  return (
    <nav
      ref={strip}
      aria-label="Month-end views"
      className="inline-flex max-w-full items-center gap-[2px] justify-self-start overflow-x-auto rounded bg-selected p-[2px] max-md:gap-2 max-md:bg-transparent max-md:p-0"
    >
      {MONTH_END_VIEWS.map((v, i) => {
        const count = counts?.[v.key]
        const on = v.key === active
        const divide = i > 0 && MONTH_END_VIEWS[i - 1].group !== v.group
        return (
          <Fragment key={v.key}>
            {divide ? <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line-strong max-md:hidden" /> : null}
            <NavLink
              to={{ pathname: v.to, search }}
              end
              aria-current={on ? 'page' : undefined}
              className={cn(
                'inline-flex h-[26px] shrink-0 items-center gap-[6px] whitespace-nowrap rounded border px-3 text-xs font-medium transition-colors duration-fast ease-out',
                'max-md:h-8 max-md:rounded-round max-md:border-line-strong',
                on
                  ? 'border-line-strong bg-surface text-fg max-md:border-tone-ink-bg max-md:bg-tone-ink-bg max-md:text-tone-ink-fg'
                  : 'border-transparent text-fg-muted hover:text-fg max-md:bg-surface',
              )}
            >
              {v.label}
              {count !== undefined ? <span className={cn('num font-regular', on ? 'text-fg-2 max-md:text-inherit' : 'text-fg-muted')}>{count}</span> : null}
            </NavLink>
          </Fragment>
        )
      })}
    </nav>
  )
}
