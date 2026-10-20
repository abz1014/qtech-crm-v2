import { forwardRef, useId, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'
import * as RadixRadio from '@radix-ui/react-radio-group'
import { cn } from '@/lib/utils'

/*
 * Radio, RadioCard (INVENTORY: U07; D08 section 01). One choice of a few, shown
 * all at once. Arrows move and choose, Tab enters and leaves the group.
 * `RadioCard` is the bordered option with a title and a help line (Capture's
 * "what to do"): the whole card is the target, the chosen one gets the ink edge.
 * More than five options, or options that are searched: use Select or Combobox.
 */
export const RadioGroup = forwardRef<ElementRef<typeof RadixRadio.Root>, ComponentPropsWithoutRef<typeof RadixRadio.Root>>(
  function RadioGroup({ className, ...rest }, ref) {
    return <RadixRadio.Root ref={ref} className={cn('grid gap-3', className)} {...rest} />
  },
)

const dot = (
  <RadixRadio.Indicator className="block size-[8px] rounded-round bg-primary" />
)

const circle =
  'grid size-[18px] shrink-0 place-items-center rounded-round border border-line-input bg-surface transition-colors duration-fast ease-out hover:border-fg-muted data-[state=checked]:border-primary disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken'

interface RadioProps extends Omit<ComponentPropsWithoutRef<typeof RadixRadio.Item>, 'children'> {
  label: ReactNode
  help?: ReactNode
}

export const Radio = forwardRef<ElementRef<typeof RadixRadio.Item>, RadioProps>(function Radio(
  { label, help, className, id: idProp, ...rest },
  ref,
) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <div className="flex items-start gap-3 text-sm">
      <RadixRadio.Item ref={ref} id={id} aria-describedby={help ? `${id}-help` : undefined} className={cn(circle, 'mt-[calc((var(--lh-sm)-18px)/2)]', className)} {...rest}>
        {dot}
      </RadixRadio.Item>
      <div className="grid">
        <label htmlFor={id} className={cn('cursor-pointer', rest.disabled && 'cursor-not-allowed text-fg-muted')}>
          {label}
        </label>
        {help ? (
          <span id={`${id}-help`} className="text-xs text-fg-muted">
            {help}
          </span>
        ) : null}
      </div>
    </div>
  )
})

export const RadioCard = forwardRef<ElementRef<typeof RadixRadio.Item>, RadioProps>(function RadioCard(
  { label, help, className, id: idProp, disabled, ...rest },
  ref,
) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded border border-line-strong bg-surface px-4 py-3 text-sm transition-colors duration-fast ease-out hover:border-line-input',
        'has-[[data-state=checked]]:border-fg has-[[data-state=checked]]:bg-sunken',
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-green',
        disabled && 'cursor-not-allowed bg-sunken hover:border-line-strong',
        className,
      )}
    >
      <RadixRadio.Item
        ref={ref}
        id={id}
        disabled={disabled}
        aria-describedby={help ? `${id}-help` : undefined}
        className={cn(circle, 'mt-[calc((var(--lh-sm)-18px)/2)] focus-visible:outline-none')}
        {...rest}
      >
        {dot}
      </RadixRadio.Item>
      <span className="grid">
        <b className={cn('font-medium', disabled && 'text-fg-muted')}>{label}</b>
        {help ? (
          <span id={`${id}-help`} className="text-xs text-fg-muted">
            {help}
          </span>
        ) : null}
      </span>
    </label>
  )
})
