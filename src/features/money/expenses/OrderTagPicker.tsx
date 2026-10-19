import { forwardRef, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import * as RadixPopover from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'
import { Kbd } from '@/ui/Kbd'
import { controlClass } from '@/ui/form/fieldContext'
import { matchOrders, type OrderTagOption } from '@/features/money/expenses/model'

/*
 * OrderTagPicker (audit X1; the burst sheet's optional "Order" cell). Type an order number ("42", "ORD-0042") or a customer's
 * name; the first match is already highlighted, Enter or Tab accepts it and Tab carries on to the next cell. Leaving the cell
 * empty is fine and Tab simply moves on: the tag is optional. Emptying the box removes the tag. Text that matches no order is
 * never dropped quietly: the box keeps showing it and the caller is told, as with the category cell.
 */
interface OrderTagPickerProps {
  orders: readonly OrderTagOption[]
  value: string | null | undefined
  onChange: (orderId: string | null) => void
  /** Called with the typed text when the field is left holding text that matches no order, and with null once resolved. */
  onUnmatched?: (text: string | null) => void
  size?: 'cell' | 'phone'
  placeholder?: string
  'aria-label'?: string
  className?: string
}

const SHOWN = 8

export const OrderTagPicker = forwardRef<HTMLInputElement, OrderTagPickerProps>(function OrderTagPicker(
  { orders, value, onChange, onUnmatched, size = 'cell', placeholder = 'optional', className, ...rest },
  ref,
) {
  const listId = useId()
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const selected = orders.find(o => o.id === value)
  const typed = (query ?? '').trim()
  const matches = useMemo(() => matchOrders(orders, typed).slice(0, SHOWN), [orders, typed])
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0))

  const close = () => {
    setOpen(false)
    setQuery(null)
  }
  const pick = (o: OrderTagOption) => {
    onChange(o.id)
    onUnmatched?.(null)
    close()
  }
  // Leaving the cell is the same as Tab: a highlighted match is taken; an emptied box clears the tag; text that matches nothing
  // stays on screen and the caller is told.
  const leave = () => {
    if (query !== null) {
      if (!typed) {
        if (value) onChange(null)
        onUnmatched?.(null)
        close()
      } else if (matches.length > 0) pick(matches[activeIndex])
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
        else setActive(Math.min(activeIndex + 1, matches.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (open) setActive(Math.max(activeIndex - 1, 0))
        break
      case 'Enter':
        if (open && typed && matches.length > 0) {
          e.preventDefault() // accepts the order; the row does not read this Enter as "add a row"
          pick(matches[activeIndex])
        }
        break
      case 'Tab':
        // The blur that follows takes the highlighted match; Tab with nothing typed just moves on.
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

  const showList = open && typed !== ''
  const optionId = (i: number) => `${listId}-o${i}`

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
            data-cell="order"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && matches.length > 0 ? optionId(activeIndex) : undefined}
            aria-label={rest['aria-label']}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={query ?? selected?.ref ?? ''}
            onChange={e => {
              onUnmatched?.(null)
              setQuery(e.target.value)
              setOpen(true)
              setActive(0)
            }}
            onFocus={e => e.currentTarget.select()}
            onKeyDown={onKeyDown}
            onBlur={leave}
            className={cn(controlClass, 'num', size === 'cell' && 'h-[36px]', size === 'phone' && 'h-[40px]', className)}
          />
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
          className="z-[70] w-[max(var(--radix-popover-trigger-width),280px)] focus:outline-none"
        >
          <div className="animate-rise-4 rounded bg-surface p-1 shadow-pop">
            <ul id={listId} role="listbox" aria-label="Orders" onMouseDown={e => e.preventDefault()} className="max-h-[272px] overflow-y-auto">
              {matches.map((o, i) => (
                <li
                  key={o.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={o.id === value}
                  data-active={i === activeIndex || undefined}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(o)}
                  className={cn(
                    'grid h-[34px] cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded px-2 text-sm',
                    i === activeIndex && 'bg-selected',
                  )}
                >
                  <span className="num font-medium">{o.ref}</span>
                  <span className="truncate text-xs text-fg-muted">{o.company}</span>
                </li>
              ))}
              {matches.length === 0 ? (
                <li role="presentation" className="flex h-[34px] items-center px-2 text-sm text-fg-muted">
                  No order matches “{typed}”
                </li>
              ) : null}
            </ul>
            <footer className="mt-[2px] flex items-center gap-4 border-t px-2 pb-[2px] pt-[6px] text-xs text-fg-muted">
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
