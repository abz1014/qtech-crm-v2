import { forwardRef, type SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { controlClass, useControlProps } from '@/ui/form/fieldContext'
import { Icon } from '@/ui/Icon'

/*
 * Select (INVENTORY: U07; D08 section 01). The native <select>, restyled: the
 * browser's own list is the most reliable picker on phones and gives type-ahead
 * for free. For a list that is searched or can add a new row, use Combobox.
 */
export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly SelectOption[]
  /** Shown when nothing is chosen ("Choose a city"). Adds an empty first option. */
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, ...rest },
  ref,
) {
  const a11y = useControlProps(rest)
  return (
    <div className="relative min-w-0">
      <select ref={ref} {...rest} {...a11y} className={cn(controlClass, 'appearance-none pr-8 invalid:text-fg-muted',
          // a <select> always matches :read-only; that is not the read-only look
          'read-only:border-line-input read-only:bg-surface read-only:text-fg read-only:hover:border-fg-muted',
          'disabled:read-only:border-line disabled:read-only:bg-sunken disabled:read-only:text-fg-disabled',
          className,
        )}>
        {placeholder !== undefined ? (
          <option value="" className="text-fg-muted">
            {placeholder}
          </option>
        ) : null}
        {options.map(o => (
          <option key={o.value} value={o.value} disabled={o.disabled} className="text-fg">
            {o.label}
          </option>
        ))}
      </select>
      <Icon icon={ChevronDown} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted" />
    </div>
  )
})
