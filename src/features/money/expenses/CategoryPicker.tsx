import { forwardRef, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import * as RadixPopover from '@radix-ui/react-popover'
import { ChevronDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { controlClass, useControlProps } from '@/ui/form/fieldContext'
import { categoryMeta, defaultGroupId, guessGroupId, sortGroups, type Category, type ExpenseGroup, type PaidVia } from '@/features/money/expenses/model'

/*
 * CategoryPicker (M03, M11; g2-month-end "Category type-ahead"; grouped 0082). Opened empty, the list shows the categories used
 * most in the last 30 days under "Recent", then every active category under its group ("Office running", "Vehicles"...). Two or
 * three letters narrow it across all groups; each match says its group and its own paid-via ("Vehicles · cash"). The first
 * match is already highlighted, Enter or Tab accepts it (Tab then carries on to the next cell), Up and Down choose, Esc closes
 * the list and only the list. The field shows "2 of 24" while typing. A dashed edge says the value was filled in for you (what
 * the dashed edge means is in the keyboard shortcuts sheet, not in a tag on every cell: round 2, R2-12). Archived categories
 * are never offered (only the current value, if it is one).
 *
 * With `onCreate` (owner request 2026-10-20), a name that is not a category yet is offered as a new one at the foot of the
 * list: 'Create "Office water"', paid in cash or by bank (one tap each, cash first: the small spends). It is filed under the
 * group of a category that shares a word with it ("Bike fuel" goes with Fuel & travel under Vehicles), else the closest match's,
 * else Office running; "Change group" under it picks another in one more tap. With no match, the
 * first of the two is highlighted, so Enter creates it; Tab and leaving the field never create anything.
 */
export type CreateCategoryResult = { id: string } | { error: string }

interface CategoryPickerProps {
  categories: readonly Category[]
  value: string | null | undefined
  onChange: (categoryId: string) => void
  /** Filled in for you: a dashed edge (no words on the cell). */
  prefilled?: boolean
  /** 36 px in the sheet's cells; the form's 32 px control by default. */
  size?: 'cell' | 'field' | 'phone'
  'aria-label'?: string
  id?: string
  disabled?: boolean
  className?: string
  /** Show the chevron of a select (the dialog's field). */
  chevron?: boolean
  /**
   * Called with the typed text when the field is left holding text that matches no category (the box keeps showing it),
   * and with null once that is resolved. A caller that saves must treat a non-null text as an unfinished field.
   */
  onUnmatched?: (text: string | null) => void
  /** Creates a category from the typed name (admin; the same rules as Settings) and returns its id, or a sentence why not. */
  onCreate?: (name: string, paidVia: PaidVia, groupId?: string | null) => Promise<CreateCategoryResult>
  /** The expense groups (0082): headings in the list, and the group a new category is filed under. */
  groups?: readonly ExpenseGroup[]
  /** The "Recent" section: the most used categories of the last 30 days (up to 5). */
  recent?: readonly Category[]
}

type Item = { kind: 'category'; c: Category } | { kind: 'create'; via: PaidVia }
const CREATE_VIAS: readonly PaidVia[] = ['cash', 'bank']
const squash = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

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
  { categories, value, onChange, prefilled, size = 'field', id: idProp, disabled, className, chevron, onUnmatched, onCreate, groups, recent, ...rest },
  ref,
) {
  const a11y = useControlProps({ id: idProp })
  const listId = useId()
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pickGroup, setPickGroup] = useState(false)
  const [chosenGroup, setChosenGroup] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const options = useMemo(() => categories.filter(c => c.active || c.id === value), [categories, value])
  const selected = categories.find(c => c.id === value)
  const typed = (query ?? '').trim()
  const q = typed.toLowerCase()
  const sortedGroups = useMemo(() => sortGroups(groups ?? []), [groups])
  /** Not typing: Recent first, then each group's categories in their saved order. Typing: ranked matches across all groups. */
  const { matches, headings } = useMemo(() => {
    const heads = new Map<number, string>()
    if (q) {
      const ranked = options
        .map(c => ({ c, r: rank(c.name, q) }))
        .filter(x => x.r >= 0)
        .sort((a, b) => a.r - b.r)
        .map(x => x.c)
      return { matches: ranked, headings: heads }
    }
    if (sortedGroups.length === 0) return { matches: options.slice(), headings: heads }
    const list: Category[] = []
    const rec = (recent ?? []).filter(c => options.some(o => o.id === c.id))
    if (rec.length > 0) {
      heads.set(0, 'Recent')
      list.push(...rec)
    }
    for (const g of sortedGroups) {
      const inGroup = options.filter(c => c.groupId === g.id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      if (inGroup.length === 0) continue
      heads.set(list.length, g.name)
      list.push(...inGroup)
    }
    const orphans = options.filter(c => !sortedGroups.some(g => g.id === c.groupId))
    if (orphans.length > 0) {
      heads.set(list.length, 'Other')
      list.push(...orphans)
    }
    return { matches: list, headings: heads }
  }, [options, q, sortedGroups, recent])
  // A name no category has yet (archived ones included: Settings would refuse the same name) can be created.
  const canCreate = !!onCreate && typed !== '' && !categories.some(c => squash(c.name) === squash(typed))
  // the group a new category goes to: picked by hand, else the group of a category sharing a word ("Bike fuel" -> Fuel & travel's
  // Vehicles), else the closest match's, else Office running
  const createGroupId = chosenGroup ?? guessGroupId(typed, options, groups ?? []) ?? (q ? matches[0]?.groupId : undefined) ?? defaultGroupId(groups ?? [])
  const createGroupName = sortedGroups.find(g => g.id === createGroupId)?.name
  const items: Item[] = useMemo(
    () => [...matches.map(c => ({ kind: 'category' as const, c })), ...(canCreate ? CREATE_VIAS.map(via => ({ kind: 'create' as const, via })) : [])],
    [matches, canCreate],
  )
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0))
  /** The highlighted category, or the first match while a create row is highlighted (Tab and leaving never create). */
  const activeMatch = matches[activeIndex < matches.length ? activeIndex : 0]
  const unique = useMemo(() => new Set(matches.map(c => c.id)).size, [matches])

  const close = () => {
    setOpen(false)
    setQuery(null)
    setCreateError(null)
    setPickGroup(false)
    setChosenGroup(null)
  }
  const pick = (c: Category) => {
    onChange(c.id)
    onUnmatched?.(null)
    close()
  }
  const create = async (via: PaidVia) => {
    if (!onCreate || creating) return
    setCreating(true)
    setCreateError(null)
    const r = await onCreate(typed, via, createGroupId)
    setCreating(false)
    if ('id' in r) {
      onChange(r.id)
      onUnmatched?.(null)
      close()
    } else setCreateError(r.error)
  }
  const choose = (item: Item) => (item.kind === 'category' ? pick(item.c) : void create(item.via))
  // Leaving the field (a click on Save, on another cell) is the same as Tab: a highlighted match is accepted. Text that
  // matches nothing is never dropped quietly: the box keeps showing it and the caller is told.
  const leave = () => {
    if (creating) return
    if (query !== null && typed) {
      if (matches.length > 0) pick(activeMatch)
      else if (onUnmatched) {
        setOpen(false)
        onUnmatched(typed)
      } else close()
      return
    }
    close()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) setOpen(true)
        else setActive(Math.min(activeIndex + 1, items.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (open) setActive(Math.max(activeIndex - 1, 0))
        break
      case 'Enter':
        if (open && items.length > 0) {
          e.preventDefault() // accepts (or creates) the category; the row does not read this Enter as "add a row"
          choose(items[activeIndex])
        }
        break
      case 'Tab':
        // Tab accepts what is highlighted when something was typed, and focus moves on as it normally does.
        if (open && typed && matches.length > 0) pick(activeMatch)
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
  const rowHeight = size === 'phone' ? 'min-h-[44px]' : 'h-[36px]'

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
            aria-activedescendant={showList && items.length > 0 ? optionId(activeIndex) : undefined}
            aria-label={rest['aria-label']}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="done"
            disabled={disabled}
            {...a11y}
            value={query ?? selected?.name ?? ''}
            onChange={e => {
              onUnmatched?.(null)
              setQuery(e.target.value)
              setCreateError(null)
              setOpen(true)
              setActive(0)
            }}
            onFocus={e => e.currentTarget.select()}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            onBlur={leave}
            className={cn(
              controlClass,
              size === 'cell' && 'h-[36px]',
              size === 'phone' && 'h-[44px] text-base',
              prefilled && !typing && 'border-dashed text-fg-2',
              typing && 'pr-24',
              chevron && !typing && 'pr-8',
              className,
            )}
          />
          {typing ? (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs leading-none text-fg-muted">
              {unique} of {options.length}
            </span>
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
          className="z-[70] w-[max(var(--radix-popover-trigger-width),320px)] max-w-[calc(100vw-16px)] focus:outline-none"
        >
          <div className="animate-rise-4 rounded bg-surface p-1 shadow-pop" onMouseDown={e => e.preventDefault()}>
            <ul id={listId} role="listbox" aria-label="Categories" className="max-h-[min(320px,45dvh)] overflow-y-auto">
              {matches.map((c, i) => [
                headings.has(i) ? (
                  <li key={`h${i}`} role="presentation" className={cn('px-2 pb-1 pt-2 text-xs font-medium text-fg-muted', i > 0 && 'mt-1 border-t')}>
                    {headings.get(i)}
                  </li>
                ) : null,
                <li
                  key={`${i}:${c.id}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={c.id === value}
                  data-active={i === activeIndex || undefined}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(c)}
                  className={cn('grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded px-2 text-sm', rowHeight, i === activeIndex && 'bg-selected')}
                >
                  <span className="truncate">
                    <Highlight label={c.name} q={q} />
                  </span>
                  <span className="text-xs text-fg-muted">{q ? categoryMeta(c, groups) : c.defaultPaidVia}</span>
                </li>,
              ])}
              {matches.length === 0 && !canCreate ? (
                <li role="presentation" className="flex h-[36px] items-center px-2 text-sm text-fg-muted">
                  No category matches “{typed}”
                </li>
              ) : null}
              {canCreate
                ? CREATE_VIAS.map((via, k) => {
                    const i = matches.length + k
                    return (
                      <li
                        key={via}
                        id={optionId(i)}
                        role="option"
                        aria-selected={false}
                        aria-disabled={creating || undefined}
                        data-active={i === activeIndex || undefined}
                        onMouseMove={() => setActive(i)}
                        onClick={() => void create(via)}
                        className={cn(
                          'grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded px-2 text-sm font-medium text-primary',
                          rowHeight,
                          k === 0 && matches.length > 0 && 'mt-1 border-t',
                          i === activeIndex && 'bg-selected',
                          creating && 'cursor-wait opacity-60',
                        )}
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <Icon icon={Plus} size="sm" />
                          <span className="truncate">Create “{typed}”</span>
                        </span>
                        <span className="text-xs font-normal text-fg-muted">{via === 'cash' ? 'paid in cash' : 'paid by bank'}</span>
                      </li>
                    )
                  })
                : null}
              {createError || creating ? (
                <li role="presentation" aria-live="polite" className={cn('px-2 py-2 text-sm', createError ? 'text-tone-danger-fg' : 'text-fg-muted')}>
                  {createError ?? 'Adding the category…'}
                </li>
              ) : null}
            </ul>
            {canCreate && sortedGroups.length > 0 ? (
              <div className="border-t px-2 py-1 text-xs text-fg-muted">
                {pickGroup ? (
                  <div role="group" aria-label="Group for the new category" className="flex flex-wrap gap-1 py-1">
                    {sortedGroups.map(g => (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={g.id === createGroupId}
                        onClick={() => {
                          setChosenGroup(g.id)
                          setPickGroup(false)
                          inputRef.current?.focus()
                        }}
                        className={cn(
                          'inline-flex items-center rounded border px-3 text-sm',
                          size === 'phone' ? 'min-h-[44px]' : 'h-[32px]',
                          g.id === createGroupId ? 'border-fg bg-selected font-medium text-fg' : 'border-line-input text-fg-2',
                        )}
                      >
                        {g.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className={cn('flex flex-wrap items-center gap-x-2', size === 'phone' ? 'min-h-[44px]' : 'min-h-[32px]')}>
                    <span>
                      Goes under <b className="font-medium text-fg-2">{createGroupName ?? 'Office running'}</b>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickGroup(true)}
                      className={cn('rounded font-medium text-primary underline-offset-2 hover:underline', size === 'phone' && 'min-h-[44px] px-2')}
                    >
                      Change group
                    </button>
                  </span>
                )}
              </div>
            ) : null}
            {size === 'phone' ? null : (
              <footer className="mt-[2px] flex items-center gap-4 border-t px-2 pb-[2px] pt-[6px] text-xs text-fg-muted">
                <span className="inline-flex items-center gap-1">
                  <Kbd size="inline">↑</Kbd>
                  <Kbd size="inline">↓</Kbd>choose
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd size="inline">Tab</Kbd>accept
                </span>
                <span className="inline-flex items-center gap-1">
                  <Kbd size="inline">Esc</Kbd>cancel
                </span>
              </footer>
            )}
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
})
