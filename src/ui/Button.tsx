import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * Button (docs/design/INVENTORY.md; D08 section 01). Variants primary,
 * secondary, quiet, danger. Sizes read the density tokens, so they follow the text size:
 * lg 52 (40 with smaller text), md 44 (32), sm 40 (28; 44 on touch), touch 44 (phone chrome).
 * States: default, hover, pressed, focus (global ring), disabled, busy.
 * Direction C: semibold labels, 10 px corners. On a navy surface (data-surface="navy": the next-step band, the top bar) the
 * green button gets a 2 px white ring, because green on navy alone is 2.71:1 (WCAG 1.4.11 wants 3:1 for its edge).
 */
const button = cva(
  [
    'group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded border',
    'font-semibold leading-none transition-[background-color,border-color,transform] duration-fast ease-out',
    'active:translate-y-[0.5px] disabled:cursor-not-allowed disabled:active:translate-y-0',
  ],
  {
    variants: {
      variant: {
        primary: [
          'border-primary bg-primary text-primary-foreground [[data-surface=navy]_&]:shadow-on-navy',
          'hover:border-primary-hover hover:bg-primary-hover active:border-primary-active active:bg-primary-active',
          'disabled:border-line disabled:bg-selected disabled:text-fg-muted',
        ],
        secondary: [
          'border-line-strong bg-surface text-fg',
          'hover:border-line-input hover:bg-sunken active:bg-selected',
          'disabled:border-line disabled:bg-sunken disabled:text-fg-disabled',
        ],
        quiet: [
          // An underlined label is the affordance: a bare word read as plain text, not something to press (an icon-only quiet button has no text to underline).
          'border-transparent bg-transparent text-fg underline decoration-fg/40 decoration-1 underline-offset-4',
          'hover:bg-sunken hover:decoration-fg active:bg-selected',
          'disabled:bg-sunken disabled:text-fg-disabled',
        ],
        danger: [
          'border-tone-danger-fg bg-tone-danger-fg text-tone-ink-fg',
          'hover:brightness-90 active:brightness-75',
          'disabled:border-line disabled:bg-sunken disabled:text-fg-disabled disabled:brightness-100',
        ],
      },
      size: {
        lg: 'h-control-lg px-4 text-base',
        md: 'h-control px-3 text-sm',
        sm: 'h-control-sm px-[10px] text-xs',
        /** Phone chrome: the 44px minimum tap target (--hit-touch). */
        touch: 'h-touch px-3 text-sm',
      },
      iconOnly: { true: 'px-0', false: '' },
    },
    compoundVariants: [
      { size: 'lg', iconOnly: true, className: 'w-control-lg' },
      { size: 'md', iconOnly: true, className: 'w-control' },
      { size: 'sm', iconOnly: true, className: 'w-control-sm' },
      { size: 'touch', iconOnly: true, className: 'w-touch' },
    ],
    defaultVariants: { variant: 'secondary', size: 'md', iconOnly: false },
  },
)

type Common = Omit<VariantProps<typeof button>, 'iconOnly'> & {
  /** Leading glyph. Muted on secondary and quiet; inherits the text colour on primary and danger. */
  icon?: LucideIcon
  /**
   * The action is in flight: aria-disabled (focus stays), clicks ignored, and shows the spinner (and `busyLabel`, the verb in -ing form).
   * Passing it at all (even false) marks a one-tap action: the repeat click of a double click is dropped, and so is any click while
   * the promise an onClick returns is still running.
   */
  busy?: boolean
  busyLabel?: ReactNode
}

type Labelled = Common & { children: ReactNode; 'aria-label'?: string }
/** An icon-only button must say what it does. */
type IconOnly = Common & { icon: LucideIcon; children?: never; 'aria-label': string }

export type ButtonProps = (Labelled | IconOnly) &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, busy: busyProp, busyLabel, className, children, disabled, type = 'button', onClick, ...rest },
  ref,
) {
  const busy = busyProp ?? false
  // HW-15: an action button (one that has a busy state) runs once per press. The second click of a double click (or double tap)
  // arrives before React re-renders with busy, so it is dropped here: by its click count, and while a returned promise is in flight.
  const inFlight = useRef(false)
  const action = busyProp !== undefined
  // Busy keeps focus (WCAG 2.4.3): aria-disabled instead of disabled, and clicks are ignored while in flight.
  const iconOnly = children === undefined || children === null
  const glyph = variant === 'primary' || variant === 'danger' ? '' : 'text-fg-muted group-disabled:text-fg-disabled'
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled && !busy}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className={cn(button({ variant, size, iconOnly }), busy && 'cursor-progress active:translate-y-0', className)}
      {...rest}
      onClick={e => {
        if (busy || (action && (inFlight.current || e.detail > 1))) {
          e.preventDefault()
          return
        }
        const result = onClick?.(e) as unknown
        if (result instanceof Promise) {
          inFlight.current = true
          const release = () => {
            inFlight.current = false
          }
          result.then(release, release)
        }
      }}
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
