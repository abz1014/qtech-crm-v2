import { forwardRef, useId, useMemo, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import { Plus, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { controlClass, useControlProps } from '@/ui/form/fieldContext'
import { Icon } from '@/ui/Icon'

/*
 * Combobox (INVENTORY: U07; D08 section 01). Search-as-you-type over a list, with
 * an optional "Add “Ind” as a new company" row. WAI-ARIA combobox pattern with a
 * listbox popup: focus stays in the input, Up/Down move the active row (the first
 * match is active as you type, so type-ahead then Enter picks it), Enter picks,
 * Esc closes the list (and only the list), Tab leaves without picking.
 *
 * Options are filtered here (label starts-with first, then contains, then meta).
 * For a server search, pass the already-fetched options and listen to
 * `onQueryChange`.
 */
export interface ComboOption {
  value: string
  label: string
  /** Muted trailing text: "Faisalabad · customer". */
  meta?: string
}

interface ComboboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'role' | 'defaultValue'> {
  options: readonly ComboOption[]
  /** The chosen option's value, or null/'' for none. */
  value: string | null | undefined
  onChange: (value: string | null) => void
  /** Show an "Add “text” …" row when something is typed. Receives the typed text. */
  onCreate?: (text: string) => void
  createLabel?: (text: string) => string
  onQueryChange?: (query: string) => void
  /** The list is being fetched: shown instead of "no match". */
  loading?: boolean
}

function rank(o: ComboOption, q: string): number {
  const l = o.label.toLowerCase()
  if (l.startsWith(q)) return 0
  if (l.split(/\s+/).some(w => w.startsWith(q))) return 1
  if (l.includes(q)) return 2
  if (o.meta?.toLowerCase().includes(q)) return 3
  return -1
}

export const Combobox = forwardRef<HTMLInputElement, ComboboxProps>(function Combobox(
  { options, value, onChange, onCreate, createLabel, onQueryChange, loading = false, className, onBlur, placeholder, ...rest },
  ref,
) {
  const a11y = useControlProps(rest)
  const listId = useId()
  const [query, setQuery] = useState<string | null>(null) // null: showing the chosen label, not typing
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const selected = options.find(o => o.value === value)
  const typed = query ?? ''
  const q = typed.trim().toLowerCase()

  const matches = useMemo(() => {
    if (!q) return options.slice()
    return options
      .map(o => ({ o, r: rank(o, q) }))
      .filter(x => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map(x => x.o)
  }, [options, q])

  const canCreate = Boolean(onCreate) && typed.trim() !== '' && !options.some(o => o.label.toLowerCase() === q)
  const rows = matches.length + (canCreate ? 1 : 0)
  const activeIndex = Math.min(active, Math.max(rows - 1, 0))

  const close = () => {
    setOpen(false)
    setQuery(null)
  }
  const pick = (o: ComboOption) => {
    onChange(o.value)
    close()
  }
  const create = () => {
    onCreate?.(typed.trim())
    close()
  }
  const choose = (i: number) => (i < matches.length ? pick(matches[i]) : create())

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) setOpen(true)
        else setActive(Math.min(activeIndex + 1, rows - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (open) setActive(Math.max(activeIndex - 1, 0))
        break
      case 'Home':
        if (open) {
          e.preventDefault()
          setActive(0)
        }
        break
      case 'End':
        if (open) {
          e.preventDefault()
          setActive(Math.max(rows - 1, 0))
        }
        break
      case 'Enter':
        if (open && rows > 0) {
          e.preventDefault() // do not submit the form
          choose(activeIndex)
        }
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation() // closes the list, not the dialog around it
          close()
        }
        break
    }
  }

  const optionId = (i: number) => `${listId}-o${i}`
  const showList = open && (rows > 0 || loading || typed.trim() !== '')

  return (
    <div className="relative min-w-0">
      <input
        ref={ref}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && rows > 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        {...rest}
        {...a11y}
        value={query ?? selected?.label ?? ''}
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
          setActive(0)
          onQueryChange?.(e.target.value)
        }}
        onFocus={e => e.currentTarget.select()}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onBlur={e => {
          close()
          onBlur?.(e)
        }}
        className={cn(controlClass, className)}
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matches"
          onMouseDown={e => e.preventDefault()}
          className="absolute inset-x-0 top-[calc(100%+4px)] z-30 max-h-[280px] animate-rise-4 overflow-y-auto rounded bg-surface p-1 shadow-pop"
        >
          {matches.map((o, i) => (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              aria-selected={o.value === value}
              data-active={i === activeIndex || undefined}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(o)}
              className={cn(
                'flex h-control cursor-pointer items-center gap-3 rounded px-2 text-sm',
                i === activeIndex && 'bg-selected',
              )}
            >
              <span className="min-w-0 truncate">
                {o.label}
              </span>
              {o.meta ? <span className="shrink-0 text-xs text-fg-muted">{o.meta}</span> : null}
            </li>
          ))}
          {rows === 0 ? (
            <li role="presentation" className="flex h-control items-center gap-2 px-2 text-sm text-fg-muted">
              <Icon icon={Search} />
              {loading ? 'Searching' : `No match for “${typed.trim()}”`}
            </li>
          ) : null}
          {canCreate ? (
            <li
              id={optionId(matches.length)}
              role="option"
              aria-selected={false}
              data-active={matches.length === activeIndex || undefined}
              onMouseMove={() => setActive(matches.length)}
              onClick={create}
              className={cn(
                'flex h-control cursor-pointer items-center gap-2 rounded px-2 text-sm text-primary',
                matches.length > 0 && 'mt-1 border-t border-line pt-1',
                matches.length === activeIndex && 'bg-selected',
              )}
            >
              <Icon icon={Plus} className="text-fg-muted" />
              {createLabel ? createLabel(typed.trim()) : `Add “${typed.trim()}” as new`}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
})
