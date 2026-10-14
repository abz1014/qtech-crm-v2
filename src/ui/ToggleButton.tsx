import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * ToggleButton (INVENTORY: U07; D08 section 13). A pressed or not-pressed
 * filter such as "Lowest only". Not a switch: the label never changes, the fill
 * and `aria-pressed` carry the state. Space or Enter toggles.
 */
interface ToggleButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onChange'> {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  icon?: LucideIcon
  children: ReactNode
}

export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(function ToggleButton(
  { pressed, onPressedChange, icon, children, className, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      onClick={e => {
        onClick?.(e)
        if (!e.defaultPrevented) onPressedChange(!pressed)
      }}
      className={cn(
        'inline-flex h-control items-center gap-2 whitespace-nowrap rounded border px-3 text-sm font-medium transition-colors duration-fast ease-out',
        pressed ? 'border-line-input bg-selected text-fg' : 'border-line-strong bg-surface text-fg hover:border-line-input hover:bg-sunken',
        'disabled:border-line disabled:bg-sunken disabled:text-fg-disabled disabled:hover:border-line',
        className,
      )}
      {...rest}
    >
      {icon ? <Icon icon={icon} className="text-fg-muted" /> : null}
      {children}
    </button>
  )
})
