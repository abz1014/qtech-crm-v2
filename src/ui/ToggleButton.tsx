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
        'inline-flex h-control items-center gap-2 whitespace-nowrap rounded-control border px-4 text-sm font-bold transition-[background-color,border-color,color,transform] duration-fast ease-out active:scale-press',
        // Forest: pressed is filled forest green with white words, 6.5:1 against the page and the unpressed tile (WCAG 1.4.11).
        pressed ? 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover' : 'border-line-strong bg-surface text-fg hover:bg-selected',
        'disabled:border-transparent disabled:bg-deep disabled:text-fg-disabled disabled:active:transform-none',
        className,
      )}
      {...rest}
    >
      {icon ? <Icon icon={icon} className={pressed ? "" : "text-fg-muted"} /> : null}
      {children}
    </button>
  )
})
