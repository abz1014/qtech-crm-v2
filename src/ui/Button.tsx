import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * Button (docs/design/INVENTORY.md; D08 section 01). Variants primary,
 * secondary, quiet, danger. Sizes: lg 40, md 32 (40 on touch), sm 28, touch 44 (phone chrome).
 * States: default, hover, pressed, focus (global ring), disabled, busy.
 */
const button = cva(
  [
    'group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded border',
    'font-medium leading-none transition-[background-color,border-color,transform] duration-fast ease-out',
    'active:translate-y-[0.5px] disabled:cursor-not-allowed disabled:active:translate-y-0',
  ],
  {
    variants: {
      variant: {
        primary: [
          'border-primary bg-primary text-primary-foreground',
          'hover:border-primary-hover hover:bg-primary-hover active:border-primary-active active:bg-primary-active',
          'disabled:border-line disabled:bg-selected disabled:text-fg-muted',
        ],
        secondary: [
          'border-line-strong bg-surface text-fg',
          'hover:border-line-input hover:bg-sunken active:bg-selected',
          'disabled:border-line disabled:bg-sunken disabled:text-fg-disabled',
        ],
        quiet: [
          'border-transparent bg-transparent text-fg',
          'hover:bg-sunken active:bg-selected',
          'disabled:bg-sunken disabled:text-fg-disabled',
        ],
        danger: [
          'border-tone-danger-fg bg-tone-danger-fg text-tone-ink-fg',
          'hover:brightness-90 active:brightness-75',
          'disabled:border-line disabled:bg-sunken disabled:text-fg-disabled disabled:brightness-100',
        ],
      },
      size: {
        lg: 'h-10 px-4 text-base',
        md: 'h-control px-3 text-sm',
        sm: 'h-[28px] px-2 text-xs',
        /** Phone chrome: the 44px minimum tap target (--hit-touch). */
        touch: 'h-touch px-3 text-sm',
      },
      iconOnly: { true: 'px-0', false: '' },
    },
    compoundVariants: [
      { size: 'lg', iconOnly: true, className: 'w-10' },
      { size: 'md', iconOnly: true, className: 'w-control' },
      { size: 'sm', iconOnly: true, className: 'w-[28px]' },
      { size: 'touch', iconOnly: true, className: 'w-touch' },
    ],
    defaultVariants: { variant: 'secondary', size: 'md', iconOnly: false },
  },
)

type Common = Omit<VariantProps<typeof button>, 'iconOnly'> & {
  /** Leading glyph. Muted on secondary and quiet; inherits the text colour on primary and danger. */
  icon?: LucideIcon
  /** The action is in flight: disables the button and shows the spinner (and `busyLabel`, the verb in -ing form). */
  busy?: boolean
  busyLabel?: ReactNode
}

type Labelled = Common & { children: ReactNode; 'aria-label'?: string }
/** An icon-only button must say what it does. */
type IconOnly = Common & { icon: LucideIcon; children?: never; 'aria-label': string }

export type ButtonProps = (Labelled | IconOnly) &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, busy = false, busyLabel, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconOnly = children === undefined || children === null
  const glyph = variant === 'primary' || variant === 'danger' ? '' : 'text-fg-muted group-disabled:text-fg-disabled'
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(button({ variant, size, iconOnly }), busy && 'disabled:cursor-progress', className)}
      {...rest}
    >
      {busy ? (
        <Icon icon={LoaderCircle} className="animate-spin motion-reduce:animate-none" />
      ) : icon ? (
        <Icon icon={icon} className={glyph} />
      ) : null}
      {iconOnly ? null : busy && busyLabel ? busyLabel : children}
    </button>
  )
})
