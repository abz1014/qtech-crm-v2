import { forwardRef, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import * as RadixPopover from '@radix-ui/react-popover'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { controlClass, useControlProps } from '@/ui/form/fieldContext'
import { categoryMeta, type Category } from '@/features/money/expenses/model'

/*
 * CategoryPicker (M03, M11; g2-month-end "Category type-ahead"). Two or three letters narrow the 17 categories; the first
 * match is already highlighted, Enter or Tab accepts it (Tab then carries on to the next cell), Up and Down choose, Esc
 * closes the list and only the list. Each row says the group and the category's own paid-via ("Overhead · cash"); the
 * footer lists the keys; the field shows "2 of 17" while typing. A dashed edge and a small tag ("most used", "carried")
 * say the value was filled in for you.
 */
interface CategoryPickerProps {
  categories: readonly Category[]
  value: string | null | undefined
  onChange: (categoryId: string) => void
  /** Filled in for you: dashed edge and the tag at the right ("most used", "carried"). */
  tag?: string
  /** 36 px in the sheet's cells; the form's 32 px control by default. */
  size?: 'cell' | 'field' | 'phone'
  'aria-label'?: string
  id?: string
  disabled?: boolean
  className?: string
  /** Show the chevron of a select (the dialog's field). */
  chevron?: boolean
}

function rank(label: string, q: string): number {
  const l = label.toLowerCase()
  if (l.startsWith(q)) return 0
  if (l.split(/[\s&]+/).some(w => w.startsWith(q))) return 1
  if (l.includes(q)) return 2
  return -1
}

/** The matched letters in bold: "Co" in "Courier & postage". */
function Highlight({ label, q }: { label: string; q: string }) {
  if (!q) return <>{label}</>
  const l = label.toLowerCase()
  let at = l.startsWith(q) ? 0 : l.search(new RegExp(`(^|[\\s&])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  if (at > 0) at += 1 // the boundary character
  if (at < 0) at = l.indexOf(q)
  if (at < 0) return <>{label}</>
  return (
    <>
      {label.slice(0, at)}
      <b className="font-semibold">{label.slice(at, at + q.length)}</b>
      {label.slice(at + q.length)}
    </>
  )
}

export const CategoryPicker = forwardRef<HTMLInputElement, CategoryPickerProps>(function CategoryPicker(
  { categories, value, onChange, tag, size = 'field', id: idProp, disabled, className, chevron, ...rest },
  ref,
) {
  const a11y = useControlProps({ id: idProp })
  const listId = useId()
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const options = useMemo(() => categories.filter(c => c.active || c.id === value), [categories, value])
  const selected = categories.find(c => c.id === value)
  const typed = (query ?? '').trim()
  const q = typed.toLowerCase()
  const matches = useMemo(() => {
    if (!q) return options.slice()
    return options
      .map(c => ({ c, r: rank(c.name, q) }))
      .filter(x => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map(x => x.c)
  }, [options, q])
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0))

  const close = () => {
    setOpen(false)
    setQuery(null)
  }
  const pick = (c: Category) => {
    onChange(c.id)
    close()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) setOpen(true)
        else setActive(Math.min(activeIndex + 1, matches.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (open) setActive(Math.max(activeIndex - 1, 0))
        break
      case 'Enter':
        if (open && matches.length > 0) {
          e.preventDefault() // accepts the category; the row does not read this Enter as "add a row"
          pick(matches[activeIndex])
        }
        break
      case 'Tab':
        // Tab accepts what is highlighted when something was typed, and focus moves on as it normally does.
        if (open && typed && matches.length > 0) pick(matches[activeIndex])
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation() // closes the list, not the sheet around it
          close()
        }
        break
    }
  }

  const showList = open && !disabled
  const optionId = (i: number) => `${listId}-o${i}`
  const typing = query !== null && typed !== ''

  return (
    <RadixPopover.Root open={showList}>
      <RadixPopover.Anchor asChild>
        <div className="relative min-w-0">
          <input
            ref={node => {
              inputRef.current = node
              if (typeof ref === 'function') ref(node)
              else if (ref) ref.current = node
            }}
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && matches.length > 0 ? optionId(activeIndex) : undefined}
            aria-label={rest['aria-label']}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            {...a11y}
            value={query ?? selected?.name ?? ''}
            onChange={e => {
              setQuery(e.target.value)
              setOpen(true)
              setActive(0)
            }}
            onFocus={e => e.currentTarget.select()}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            onBlur={close}
            className={cn(
              controlClass,
              size === 'cell' && 'h-[36px]',
              size === 'phone' && 'h-[40px]',
              tag && !typing && 'border-dashed text-fg-2',
              (tag || chevron) && 'pr-24',
              chevron && !tag && 'pr-8',
              className,
            )}
          />
          {typing ? (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs leading-none text-fg-muted">
              {matches.length} of {options.length}
            </span>
          ) : tag ? (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 whitespace-nowrap text-xs leading-none text-fg-muted">{tag}</span>
          ) : chevron ? (
            <Icon icon={ChevronDown} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted" />
          ) : null}
        </div>
      </RadixPopover.Anchor>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          onInteractOutside={e => {
            if (inputRef.current?.parentElement?.contains(e.target as Node)) e.preventDefault()
          }}
          className="z-[70] w-[max(var(--radix-popover-trigger-width),300px)] focus:outline-none"
        >
          <div className="animate-rise-4 rounded bg-surface p-1 shadow-pop">
            <ul id={listId} role="listbox" aria-label="Categories" onMouseDown={e => e.preventDefault()} className="max-h-[272px] overflow-y-auto">
              {matches.map((c, i) => (
                <li
                  key={c.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={c.id === value}
                  data-active={i === activeIndex || undefined}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(c)}
                  className={cn(
                    'grid h-[34px] cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded px-2 text-sm',
                    i === activeIndex && 'bg-selected',
                  )}
                >
                  <span className="truncate">
                    <Highlight label={c.name} q={q} />
                  </span>
                  <span className="text-xs text-fg-muted">{categoryMeta(c)}</span>
                </li>
              ))}
              {matches.length === 0 ? (
                <li role="presentation" className="flex h-[34px] items-center px-2 text-sm text-fg-muted">
                  No category matches “{typed}”
                </li>
              ) : null}
            </ul>
            <footer className="mt-[2px] flex items-center gap-4 border-t px-2 pb-[2px] pt-[6px] text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1">
                <Kbd className="h-4 min-w-4 text-xs">↑</Kbd>
                <Kbd className="h-4 min-w-4 text-xs">↓</Kbd>choose
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd className="h-4 min-w-4 text-xs">Tab</Kbd>accept
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd className="h-4 min-w-4 text-xs">Esc</Kbd>cancel
              </span>
            </footer>
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
})
