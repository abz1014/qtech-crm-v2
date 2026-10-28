import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { TextField } from '@/ui/form/TextField'

/*
 * TableFilter (consistency spec 3.1): THE list search, the first control on the left of a DataTable toolbar.
 *   <TableFilter label="Search orders" hint="Finds an order by customer, site, item, order number or PO." value={q} onChange={setQ} />
 * - `label` is both the accessible name and the placeholder, always "Search {plural noun}". Which fields it searches goes in
 *   `hint` (read as the field's description) and in the NoResults state, never in the placeholder.
 * - 320 px from `sm`, full width on a phone, --control-h tall.
 * - Keys: DataTable's `/` focuses it (data-table-filter; aria-keyshortcuts="/"). Esc clears; a second Esc, with nothing left to
 *   clear, leaves the field for the table's current row.
 * - Hints: a `/` key sits at the right edge from `md` while the field is empty and not focused; with text, a clear (x) button
 *   takes its place (--control-h square: 44 px on touch).
 * Matching (every word, case-insensitive) is the page's job; keep the text in `?q=` with useQueryParamText (lib/useQueryParamText).
 */
export function TableFilter({
  value,
  onChange,
  label,
  hint,
  className,
}: {
  value: string
  onChange: (next: string) => void
  /** "Search orders": the name and the placeholder. */
  label: string
  /** What it searches, in a sentence ("Finds an order by customer, item, order number or PO."). Screen readers hear it as the description. */
  hint?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const hintId = useId()
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (value !== '') {
      e.preventDefault()
      onChange('')
    } else {
      // Second Esc leaves the field for the table's current row (WCAG 2.4.3), never for <body>. No table: focus stays here.
      const row = e.currentTarget.closest('[data-table-root]')?.querySelector<HTMLElement>('[data-di][tabindex="0"]')
      row?.focus()
    }
  }
  const clear = () => {
    onChange('')
    inputRef.current?.focus()
  }
  return (
    <div className={cn('relative w-full sm:w-[320px]', className)}>
      <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
      <TextField
        ref={inputRef}
        data-table-filter=""
        aria-label={label}
        aria-keyshortcuts="/"
        aria-describedby={hint ? hintId : undefined}
        placeholder={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        className={cn('pl-8', value !== '' ? 'pr-[var(--control-h)]' : 'max-md:pr-3 md:pr-[var(--control-h)]')}
      />
      {hint ? (
        <span id={hintId} hidden>
          {hint}
        </span>
      ) : null}
      {value !== '' ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute right-0 top-0 grid h-control w-control place-items-center rounded text-fg-muted transition-colors duration-fast ease-out hover:text-fg"
        >
          <Icon icon={X} />
        </button>
      ) : !focused ? (
        <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 max-md:hidden">
          <Kbd>/</Kbd>
        </span>
      ) : null}
    </div>
  )
}
