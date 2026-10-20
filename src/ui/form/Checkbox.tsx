import { forwardRef, useId, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'
import * as RadixCheckbox from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * Checkbox (INVENTORY: U07; D08 section 01). 18px box. The
 * checked fill is the primary action colour.
 * Label is the click target as well as the name. The only label-less use is a
 * table row or header tick: pass `aria-label` instead and no label is drawn.
 * Supports "indeterminate" for a select-all header. Space toggles.
 * Touch (pointer: coarse): the label is 44px tall (--hit-touch) with the box centred on its line; a label-less box sits in an
 * empty 44px label that takes the tap, drawn with negative margins so the row keeps its height.
 */
const TOUCH_LABEL = '[@media(pointer:coarse)]:py-[calc((var(--hit-touch)-var(--lh-sm))/2)]'
const TOUCH_BOX = '[@media(pointer:coarse)]:mt-[calc((var(--hit-touch)-18px)/2)]'
const TOUCH_AREA =
  '[@media(pointer:coarse)]:-m-[13px] [@media(pointer:coarse)]:inline-grid [@media(pointer:coarse)]:size-touch [@media(pointer:coarse)]:shrink-0 [@media(pointer:coarse)]:place-items-center'
interface CheckboxProps extends Omit<ComponentPropsWithoutRef<typeof RadixCheckbox.Root>, 'children'> {
  label?: ReactNode
  help?: ReactNode
}

export const Checkbox = forwardRef<ElementRef<typeof RadixCheckbox.Root>, CheckboxProps>(function Checkbox(
  { label, help, className, id: idProp, ...rest },
  ref,
) {
  const auto = useId()
  const id = idProp ?? auto
  if (label === undefined && !rest['aria-label'] && !rest['aria-labelledby']) {
    throw new Error('Checkbox needs a label, or an aria-label when it is drawn without one.')
  }
  const box = (
    <RadixCheckbox.Root
      ref={ref}
      id={id}
      aria-describedby={help ? `${id}-help` : undefined}
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded border border-line-input bg-surface text-primary-foreground',
        'transition-colors duration-fast ease-out hover:border-fg-muted',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        'disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken',
        'mt-[calc((var(--lh-sm)-18px)/2)]',
        label !== undefined ? TOUCH_BOX : '[@media(pointer:coarse)]:mt-0',
        className,
      )}
      {...rest}
    >
      <RadixCheckbox.Indicator>
        <Icon icon={rest.checked === 'indeterminate' ? Minus : Check} size="chip" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
  return (
    <div className="flex items-start gap-3 text-sm">
      {label !== undefined ? (
        box
      ) : (
        <label htmlFor={id} className={TOUCH_AREA}>
          {box}
        </label>
      )}
      {label !== undefined ? (
        <div className="grid">
          <label htmlFor={id} className={cn('cursor-pointer', TOUCH_LABEL, rest.disabled && 'cursor-not-allowed text-fg-muted')}>
            {label}
          </label>
          {help ? (
            <span id={`${id}-help`} className="text-xs text-fg-muted">
              {help}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
