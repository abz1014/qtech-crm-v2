import { useContext } from 'react'
import { Search, X } from 'lucide-react'
import { PaletteContext } from '@/app/palette/usePalette'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'

/*
 * NoResults (consistency spec 3.3): what a list shows when its search or filters match nothing. Built on EmptyState, neutral.
 *   <NoResults query={q} scope="orders" fields="customer, site, item, order number and PO"
 *     filtersOn={['Goods: Late']} onClear={clearSearchAndFilters} />
 * - Title: Nothing matches "{q}" (with no text, only filters: "Nothing matches these filters").
 * - Body: "Searched {scope} by {fields}." and, when filters are on, "Filters on: {list}."
 * - Actions (two at most): Clear search ("Clear search and filters" when filters are on; "Clear the filters" with no text), and
 *   Search everywhere for "{q}", which opens the command palette with the text in its box (it covers companies, contacts, every
 *   RFQ including closed ones, orders, items, supplier POs and invoices). That action is left out with no text, or outside the
 *   app shell (no palette).
 * Not for an empty list (no data yet): that is a goal or first-use EmptyState, with no search suggestion.
 */
export interface NoResultsProps {
  /** The search text as typed ('' when only filters narrowed the list). */
  query: string
  /** What was searched, plural: "orders", "open RFQs", "every closed RFQ". */
  scope: string
  /** Which fields, as a phrase: "customer, site, item, order number and PO". */
  fields: string
  /** Human labels of the filters that are on ("Goods: Late"). Empty or absent: none. */
  filtersOn?: readonly string[]
  /** Clears the search, and the filters when some are on. */
  onClear: () => void
  className?: string
}

export function NoResults({ query, scope, fields, filtersOn = [], onClear, className }: NoResultsProps) {
  const open = useContext(PaletteContext)?.open
  const q = query.trim()
  const filters = filtersOn.length > 0
  const clearLabel = q && filters ? 'Clear search and filters' : q ? 'Clear search' : 'Clear the filters'
  return (
    <EmptyState
      mood="neutral"
      title={q ? `Nothing matches "${q}"` : 'Nothing matches these filters'}
      className={className}
      actions={
        <>
          <Button icon={X} onClick={onClear}>
            {clearLabel}
          </Button>
          {q && open ? (
            <Button icon={Search} onClick={() => open(q)}>
              {`Search everywhere for "${q}"`}
            </Button>
          ) : null}
        </>
      }
    >
      {`Searched ${scope} by ${fields}.`}
      {filters ? ` Filters on: ${filtersOn.join(', ')}.` : null}
    </EmptyState>
  )
}
