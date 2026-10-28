import { Fragment, useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { Check, Ellipsis, type LucideIcon } from 'lucide-react'
import { useBackToClose } from '@/lib/useBackToClose'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/*
 * The ⋯ of a category or group row: a menu on a desktop, a bottom sheet on a phone (g2-login-team-settings "Row actions as
 * a bottom sheet": a grab handle, what the actions are for, then 44 px rows, the destructive one last and red).
 */
export interface RowMenuItem {
  key: string
  label: string
  icon?: LucideIcon
  danger?: boolean
  /** A choice of a few (Cash / Bank): drawn with a tick. */
  checked?: boolean
  /** Draw a separator above this item. */
  separated?: boolean
  onSelect: () => void
}

interface RowMenuProps {
  /** "More for Water" (the row-menu name, src/ui/MoreMenu): names the button and the menu. */
  label: string
  /** The sheet's heading and sub line on a phone. */
  title: string
  subtitle?: string
  items: readonly RowMenuItem[]
  phone: boolean
}

export function RowMenu({ label, title, subtitle, items, phone }: RowMenuProps) {
  const [open, setOpen] = useState(false)
  if (phone) {
    return (
      <>
        <Button size="touch" variant="quiet" icon={Ellipsis} aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)} />
        {open ? <ActionSheet title={title} subtitle={subtitle} items={items} onClose={() => setOpen(false)} /> : null}
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="touch" variant="quiet" icon={Ellipsis} aria-label={label} aria-haspopup="menu" />
      </PopoverTrigger>
      <PopoverContent variant="menu" align="end" aria-label={label} className="min-w-[240px]">
        {items.map(it => (
          <Fragment key={it.key}>
            {it.separated ? <MenuSeparator /> : null}
            <MenuItem
              icon={it.checked === undefined ? it.icon : undefined}
              danger={it.danger}
              checked={it.checked}
              onClick={() => {
                setOpen(false)
                it.onSelect()
              }}
            >
              {it.label}
            </MenuItem>
          </Fragment>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function ActionSheet({ title, subtitle, items, onClose }: { title: string; subtitle?: string; items: readonly RowMenuItem[]; onClose: () => void }) {
  useBackToClose(true, onClose)
  return (
    <RadixDialog.Root open onOpenChange={o => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 animate-fade-in bg-scrim" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] animate-sheet-in overflow-y-auto rounded-t bg-surface pb-[max(var(--sp-4),env(safe-area-inset-bottom,0px))] shadow-modal focus:outline-none"
        >
          <div aria-hidden="true" className="mx-auto mb-1 mt-2 h-1 w-[2.25rem] rounded-round bg-line-strong" />
          <div className="grid border-b px-4 pb-3 pt-2">
            <RadixDialog.Title className="min-w-0 text-base font-semibold text-fg [overflow-wrap:anywhere]">{title}</RadixDialog.Title>
            {subtitle ? <span className="min-w-0 text-sm text-fg-muted [overflow-wrap:anywhere]">{subtitle}</span> : null}
          </div>
          <ul>
            {items.map(it => (
              <li key={it.key} className={cn(it.separated && 'mt-1 border-t pt-1')}>
                <button
                  type="button"
                  aria-pressed={it.checked}
                  onClick={() => {
                    onClose()
                    it.onSelect()
                  }}
                  className={cn(
                    'flex min-h-touch w-full items-center gap-3 px-4 py-2 text-left text-base font-medium active:bg-sunken',
                    it.danger ? 'text-tone-danger-fg' : 'text-fg',
                  )}
                >
                  {it.checked !== undefined ? (
                    <Icon icon={Check} size="lg" className={cn('text-primary', !it.checked && 'invisible')} />
                  ) : it.icon ? (
                    <Icon icon={it.icon} size="lg" className={it.danger ? undefined : 'text-fg-muted'} />
                  ) : null}
                  {it.label}
                </button>
              </li>
            ))}
          </ul>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
