import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * Breadcrumb (INVENTORY: U03; D08 section 01). Page ancestry on detail pages:
 * "RFQs > RFQ-0177 > Item 2". Ancestors are links, the last item is the current
 * page (aria-current). Identifiers are set mono.
 */
export interface Crumb {
  label: string
  /** Route of an ancestor. Omit on the current page. */
  to?: string
  /** Identifier (RFQ-0177): mono. */
  mono?: boolean
}

export function Breadcrumb({ items, className }: { items: readonly Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-fg-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1
          const cls = cn(c.mono && 'num', last ? 'text-fg-2' : 'rounded hover:text-fg')
          return (
            <Fragment key={`${c.label}-${i}`}>
              <li className="inline-flex items-center">
                {c.to && !last ? (
                  <Link to={c.to} className={cls}>
                    {c.label}
                  </Link>
                ) : (
                  <span className={cls} aria-current={last ? 'page' : undefined}>
                    {c.label}
                  </span>
                )}
              </li>
              {last ? null : (
                <li aria-hidden="true" className="inline-flex">
                  <Icon icon={ChevronRight} size="sm" />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
